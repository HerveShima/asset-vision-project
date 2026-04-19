import base64
import json
import mimetypes
import os
import secrets
import shutil
import sqlite3
import uuid
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from functools import wraps
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, send_file, send_from_directory, session
from flask_cors import CORS
from openai import OpenAI
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()


def load_secret_key():
    env_secret = os.getenv("SECRET_KEY")
    if env_secret:
        return env_secret

    secret_path = Path(__file__).resolve().parent / ".homevault_secret"
    if secret_path.exists():
        return secret_path.read_text(encoding="utf-8").strip()

    generated = secrets.token_hex(32)
    secret_path.write_text(generated, encoding="utf-8")
    return generated


app = Flask(__name__, static_folder="static")
app.config["SECRET_KEY"] = load_secret_key()
app.config["DATABASE"] = Path(app.root_path) / "homevault.db"
app.config["UPLOAD_FOLDER"] = Path(app.static_folder) / "uploads"
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
CORS(app, supports_credentials=True)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SERP_API_KEY = os.getenv("SERP_API_KEY")
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

ALLOWED_CATEGORIES = {"Electronics", "Furniture", "Appliances", "Other"}
IMAGE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
GENERIC_ITEM_TERMS = {
    "chair", "table", "desk", "dresser", "sofa", "couch", "shoe", "sneaker",
    "boot", "shirt", "pants", "jacket", "coat", "backpack", "bag", "lamp",
    "phone", "laptop", "tablet", "tv", "television", "monitor", "speaker",
    "headphone", "earbud", "appliance", "microwave", "refrigerator", "fridge",
    "washer", "dryer", "vacuum", "blender", "mixer", "fan", "bed", "mattress",
}
GENERIC_MODIFIERS = {
    "black", "white", "brown", "wooden", "metal", "plastic", "pair", "set",
    "office", "home", "indoor", "outdoor", "small", "large", "standard",
    "generic", "basic",
}


def now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def default_emoji(category):
    return {
        "Electronics": "💻",
        "Furniture": "🪑",
        "Appliances": "🌀",
        "Other": "📦",
    }.get(category, "📦")


def normalize_category(value):
    value = (value or "").strip().title()
    if value in ALLOWED_CATEGORIES:
        return value
    fallback = {
        "Electronic": "Electronics",
        "Electronics & Gadgets": "Electronics",
        "Furnishing": "Furniture",
        "Appliance": "Appliances",
    }
    return fallback.get(value, "Other")


def normalize_email(value):
    return (value or "").strip().lower()


def validate_password(password):
    if len(password or "") < 10:
        return "Password must be at least 10 characters long."
    if not any(char.islower() for char in password):
        return "Password must include a lowercase letter."
    if not any(char.isupper() for char in password):
        return "Password must include an uppercase letter."
    if not any(char.isdigit() for char in password):
        return "Password must include a number."
    if not any(not char.isalnum() for char in password):
        return "Password must include a symbol."
    return None


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(app.config["DATABASE"])
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users
        (
            id
            INTEGER
            PRIMARY
            KEY
            AUTOINCREMENT,
            email
            TEXT
            NOT
            NULL
            UNIQUE,
            password_hash
            TEXT
            NOT
            NULL,
            created_at
            TEXT
            NOT
            NULL,
            last_login_at
            TEXT
        );

        CREATE TABLE IF NOT EXISTS items
        (
            id
            INTEGER
            PRIMARY
            KEY
            AUTOINCREMENT,
            user_id
            INTEGER
            NOT
            NULL,
            name
            TEXT
            NOT
            NULL,
            cat
            TEXT
            NOT
            NULL,
            val
            REAL
            NOT
            NULL,
            low
            REAL
            NOT
            NULL,
            high
            REAL
            NOT
            NULL,
            conf
            INTEGER
            NOT
            NULL,
            emoji
            TEXT
            NOT
            NULL,
            date
            TEXT
            NOT
            NULL,
            condition
            INTEGER
            NOT
            NULL
            DEFAULT
            85,
            image_url
            TEXT,
            image_hash
            TEXT,
            price_source
            TEXT,
            quantity
            INTEGER
            NOT
            NULL
            DEFAULT
            1,
            listing_count
            INTEGER
            NOT
            NULL
            DEFAULT
            0,
            active_listing_count
            INTEGER
            NOT
            NULL
            DEFAULT
            0,
            coverage_status
            TEXT
            NOT
            NULL
            DEFAULT
            'standard',
            coverage_note
            TEXT,
            created_at
            TEXT
            NOT
            NULL,
            updated_at
            TEXT
            NOT
            NULL,
            FOREIGN
            KEY
        (
            user_id
        ) REFERENCES users
        (
            id
        )
            );

        CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);
        CREATE INDEX IF NOT EXISTS idx_items_image_hash ON items(image_hash);

        CREATE TABLE IF NOT EXISTS price_cache
        (
            item_key
            TEXT
            PRIMARY
            KEY,
            category
            TEXT
            NOT
            NULL,
            avg
            REAL,
            low
            REAL,
            high
            REAL,
            listing_count
            INTEGER
            NOT
            NULL
            DEFAULT
            0,
            active_listing_count
            INTEGER
            NOT
            NULL
            DEFAULT
            0,
            source
            TEXT
            NOT
            NULL,
            coverage_note
            TEXT,
            updated_at
            TEXT
            NOT
            NULL
        );
        """
    )
    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(items)").fetchall()}
    if "quantity" not in existing_columns:
        conn.execute("ALTER TABLE items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1")
    if "listing_count" not in existing_columns:
        conn.execute("ALTER TABLE items ADD COLUMN listing_count INTEGER NOT NULL DEFAULT 0")
    if "active_listing_count" not in existing_columns:
        conn.execute("ALTER TABLE items ADD COLUMN active_listing_count INTEGER NOT NULL DEFAULT 0")
    if "coverage_status" not in existing_columns:
        conn.execute("ALTER TABLE items ADD COLUMN coverage_status TEXT NOT NULL DEFAULT 'standard'")
    if "coverage_note" not in existing_columns:
        conn.execute("ALTER TABLE items ADD COLUMN coverage_note TEXT")
    conn.commit()
    conn.close()


def serialize_user(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "created_at": row["created_at"],
        "last_login_at": row["last_login_at"],
    }


def serialize_item(row):
    source = row["price_source"] or "eBay sold listings"
    if "eBay sold listings" in source:
        source = "eBay sold listings"
    stored_status = row["coverage_status"] or "standard"
    stored_note = row["coverage_note"]
    coverage_status, coverage_note = assess_coverage(row["name"], row["cat"])
    pricing_ready, pricing_note = assess_pricing_detail(row["name"], row["cat"])
    if coverage_status != "excluded" and (stored_status == "review" or not pricing_ready):
        coverage_status = "review"
        coverage_note = stored_note or pricing_note
    return {
        "id": row["id"],
        "name": row["name"],
        "cat": row["cat"],
        "val": float(row["val"]),
        "low": float(row["low"]),
        "high": float(row["high"]),
        "conf": int(row["conf"]),
        "emoji": row["emoji"],
        "date": row["date"],
        "condition": int(row["condition"]),
        "quantity": int(row["quantity"] or 1),
        "listing_count": int(row["listing_count"] or 0),
        "active_listing_count": int(row["active_listing_count"] or 0),
        "image_url": row["image_url"],
        "image_hash": row["image_hash"],
        "price_source": source,
        "coverage_status": coverage_status,
        "coverage_note": coverage_note or stored_note,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def current_user_row():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def login_user(user_id):
    session.clear()
    session.permanent = False
    session["user_id"] = int(user_id)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user_row()
        if not user:
            return jsonify({"error": "Please sign in to continue."}), 401
        g.current_user = user
        return view(*args, **kwargs)

    return wrapped


def parse_json_body():
    return request.get_json(force=True, silent=False) or {}


def clean_model_json(raw_text):
    return raw_text.replace("```json", "").replace("```", "").strip()


def normalize_detected_items(payload):
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raw_items = [payload] if payload.get("name") else []

    items = []
    for index, item in enumerate(raw_items[:6]):
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or "").strip()
        if not name:
            continue
        category = normalize_category(item.get("category"))
        confidence = int(max(0, min(100, item.get("confidence", 0) or 0)))
        quantity = int(max(1, min(25, item.get("quantity", 1) or 1)))
        emoji = (item.get("emoji") or "").strip() or default_emoji(category)
        items.append(
            {
                "id": f"detected-{index}",
                "name": name,
                "category": category,
                "confidence": confidence,
                "quantity": quantity,
                "emoji": emoji,
            }
        )

    if not items and payload.get("name"):
        category = normalize_category(payload.get("category"))
        items.append(
            {
                "id": "detected-0",
                "name": payload["name"].strip(),
                "category": category,
                "confidence": int(max(0, min(100, payload.get("confidence", 0) or 0))),
                "quantity": int(max(1, min(25, payload.get("quantity", 1) or 1))),
                "emoji": (payload.get("emoji") or "").strip() or default_emoji(category),
            }
        )

    aggregated = {}
    for item in items:
        key = (normalized_name(item["name"]), item["category"])
        if key not in aggregated:
            aggregated[key] = item.copy()
            continue
        aggregated[key]["quantity"] += item["quantity"]
        aggregated[key]["confidence"] = max(aggregated[key]["confidence"], item["confidence"])

    return sorted(aggregated.values(), key=lambda item: item["confidence"], reverse=True)


def call_openai_identify(image_b64, mime_type):
    if not openai_client:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    prompt = (
        "You are an expert home inventory analyst. "
        "Detect the important household items in this image. "
        "If multiple distinct items are visible, return each distinct item separately. "
        "If the same kind of item appears more than once, return it once with a quantity. "
        "For footwear, count pairs rather than individual shoes. "
        "Use singular item names even when quantity is greater than one. "
        "Avoid generic plural labels such as chairs, tables, or shoes. "
        "Prefer a specific visible type such as wooden dining chair, coffee table, running shoe, or leather backpack. "
        "Prioritize brand and model when readable, but do not invent extra descriptors such as desk, office, or gaming unless they are visually clear. "
        "Use a more generic label when uncertain. Ignore tiny background clutter. "
        "Return only valid JSON in this exact shape: "
        '{"items":[{"name":"<specific item name>","category":"Electronics|Furniture|Appliances|Other","confidence":90,"quantity":1,"emoji":"<single emoji>"}]}'
    )

    response = openai_client.chat.completions.create(
        model="gpt-4o",
        max_tokens=450,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{image_b64}",
                            "detail": "high",
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    raw = clean_model_json(response.choices[0].message.content or "")
    parsed = json.loads(raw)
    items = normalize_detected_items(parsed)
    if not items:
        raise RuntimeError("No recognizable items were found in the image.")
    return items


def guess_extension(mime_type):
    if mime_type in IMAGE_EXTENSIONS:
        return IMAGE_EXTENSIONS[mime_type]
    guessed = mimetypes.guess_extension(mime_type or "")
    return guessed or ".jpg"


def save_image(image_b64, mime_type, user_id):
    if not image_b64:
        return None

    image_bytes = base64.b64decode(image_b64)
    ext = guess_extension(mime_type)
    user_dir = app.config["UPLOAD_FOLDER"] / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    output_path = user_dir / filename
    output_path.write_bytes(image_bytes)
    return f"/static/uploads/{user_id}/{filename}"


def hamming_distance(left, right):
    if not left or not right or len(left) != len(right):
        return 64
    return sum(1 for a, b in zip(left, right) if a != b)


def normalized_name(value):
    return "".join(ch.lower() for ch in (value or "") if ch.isalnum() or ch.isspace()).strip()


def singularize_token(token):
    token = (token or "").strip().lower()
    if token.endswith("ies") and len(token) > 3:
        return token[:-3] + "y"
    if token.endswith("ses") and len(token) > 3:
        return token[:-2]
    if token.endswith("s") and len(token) > 2 and not token.endswith("ss"):
        return token[:-1]
    return token


def price_ranges_close(existing, low, high, value):
    existing_low = float(existing["low"])
    existing_high = float(existing["high"])
    existing_val = float(existing["val"])

    if max(existing_low, low) <= min(existing_high, high):
        return True

    baseline = max(existing_val, value, 1)
    return abs(existing_val - value) / baseline <= 0.15


def assess_coverage(name, category):
    label = normalized_name(name)

    checks = [
        (
            ("bracket challenge", "tournament bracket", "office bracket"),
            "excluded",
            "Bracket or challenge graphics are not treated as claim-ready insured assets in this report.",
        ),
        (
            (
                "coca cola", "coke bottle", "coke can", "soda bottle", "soft drink",
                "beverage bottle", "water bottle", "juice bottle", "sports drink",
                "energy drink", "sparkling water", "seltzer", "cola", "drink can",
            ),
            "excluded",
            "Everyday beverage items are excluded from insurance-ready reporting because they are consumable goods, not durable assets.",
        ),
        (
            ("cash", "currency", "gift card", "giftcard", "coin collection", "bullion", "checkbook", "check book"),
            "review",
            "Cash-like items often need special handling and may not be standard personal-property claims.",
        ),
        (
            ("car", "truck", "motorcycle", "scooter", "boat", "rv", "motorhome", "trailer", "atv"),
            "review",
            "Vehicles usually need a separate vehicle policy instead of standard home inventory coverage.",
        ),
        (
            ("dog", "cat", "bird", "fish tank", "aquarium fish", "pet", "hamster", "rabbit", "reptile"),
            "review",
            "Pets and animal-related losses are usually not handled as standard personal-property items.",
        ),
        (
            ("inventory", "merchandise", "stock", "products for sale", "for sale"),
            "review",
            "Business inventory often has limited or separate coverage under standard home policies.",
        ),
        (
            (
                "food", "groceries", "meal", "frozen", "perishable", "snack", "snacks",
                "cookie", "cookies", "cracker", "crackers", "biscuit", "biscuits",
                "chips", "candy", "chocolate", "cereal", "granola", "butter cookies",
                "popcorn", "bread", "fruit", "vegetable", "soup", "sauce", "pantry",
                "tea box", "coffee bag", "coffee beans", "milk carton", "yogurt",
            ),
            "excluded",
            "Perishable food and consumables are excluded from insurance-ready reporting.",
        ),
        (
            ("figurine", "statuette", "ornament", "novelty statue", "wizard figurine", "decor statue"),
            "excluded",
            "Novelty figurines and decor collectibles are excluded from automated claim-ready pricing in this MVP.",
        ),
    ]

    for keywords, status, note in checks:
        if any(keyword in label for keyword in keywords):
            return status, note

    if category not in ALLOWED_CATEGORIES:
        return "review", "This item may need insurer review because it falls outside the main covered household categories."

    return "standard", None


def assess_pricing_detail(name, category):
    tokens = [token for token in normalized_name(name).split() if token]
    singular_tokens = [singularize_token(token) for token in tokens]
    non_modifier_tokens = [token for token in singular_tokens if token not in GENERIC_MODIFIERS]
    specific_tokens = [token for token in non_modifier_tokens if token not in GENERIC_ITEM_TERMS]

    if not non_modifier_tokens:
        return False, "This item needs a clearer brand, model, or more specific label before HomeVault can estimate a reliable market value."

    if len(non_modifier_tokens) == 1 and non_modifier_tokens[0] in GENERIC_ITEM_TERMS:
        if category == "Electronics":
            return False, "This item may be claim-eligible, but the photo is too broad for reliable pricing. Capture a clearer photo with the brand or model visible."
        if category == "Furniture":
            return False, "This item may be claim-eligible, but the label is too broad for reliable pricing. Capture the full item clearly and use a more specific furniture type."
        if non_modifier_tokens[0] in {"shoe", "sneaker", "boot", "backpack", "bag", "shirt", "jacket", "coat"}:
            return False, "This item may be claim-eligible, but the photo needs more detail. Capture the full item clearly and include any visible brand or logo."
        return False, "This item may be claim-eligible, but the label is too broad for reliable sold-listing pricing. Capture a clearer photo and use a more specific item type."

    if not specific_tokens and category == "Other":
        if any(token in {"shoe", "sneaker", "boot", "backpack", "bag", "shirt", "jacket", "coat"} for token in
               non_modifier_tokens):
            return False, "This item may be personal property, but pricing needs a clearer photo of the full item and any visible brand or logo."
        return False, "This item may be personal property, but pricing needs a clearer photo and a more specific product name before it can be trusted."

    return True, None


def pricing_confidence_ceiling(name, category):
    pricing_ready, _note = assess_pricing_detail(name, category)
    if pricing_ready:
        return 100

    normalized_tokens = {singularize_token(token) for token in normalized_name(name).split() if token}
    if category == "Electronics":
        return 72
    if category == "Furniture":
        return 76
    if normalized_tokens & {"shoe", "sneaker", "boot", "backpack", "bag", "shirt", "jacket", "coat"}:
        return 74
    return 70


def search_tokens(value):
    stop_words = {
        "the", "and", "for", "with", "from", "item", "home", "black", "white",
        "inch", "inches", "new", "used", "set", "piece", "pcs",
    }
    tokens = []
    for raw in normalized_name(value).split():
        if len(raw) < 2 or raw in stop_words:
            continue
        tokens.append(singularize_token(raw))
    return tokens


def accessory_listing(title):
    lowered = normalized_name(title)
    accessory_terms = (
        "case", "cover", "charger", "manual", "box only", "empty box", "parts",
        "repair", "replacement", "sticker", "poster", "frame only", "shell",
        "remote only", "stand only", "cable", "cord", "mount", "bundle of",
    )
    return any(term in lowered for term in accessory_terms)


def title_match_score(query, title):
    query_tokens = search_tokens(query)
    title_tokens = set(search_tokens(title))
    if not query_tokens or not title_tokens:
        return 0
    matches = sum(1 for token in query_tokens if token in title_tokens)
    return matches / max(len(query_tokens), 1)


def filtered_prices(item_name, listings):
    prices = []
    for listing in listings:
        title = listing.get("title", "")
        extracted = (listing.get("price") or {}).get("extracted")
        if not isinstance(extracted, (int, float)) or extracted <= 0:
            continue
        if accessory_listing(title):
            continue
        if title_match_score(item_name, title) < 0.55:
            continue
        prices.append(float(extracted))
    return prices


def filtered_listing_count(item_name, listings):
    count = 0
    for listing in listings:
        title = listing.get("title", "")
        if accessory_listing(title):
            continue
        if title_match_score(item_name, title) < 0.55:
            continue
        count += 1
    return count


def cache_key(item_name, category):
    return f"{normalize_category(category)}|{normalized_name(item_name)}"


def read_price_cache(item_name, category):
    row = get_db().execute(
        "SELECT * FROM price_cache WHERE item_key = ?",
        (cache_key(item_name, category),),
    ).fetchone()
    if not row:
        return None

    updated_at = parse_iso(row["updated_at"])
    if not updated_at or datetime.utcnow() - updated_at > timedelta(hours=24):
        return None

    return {
        "avg": float(row["avg"]) if row["avg"] is not None else None,
        "low": float(row["low"]) if row["low"] is not None else None,
        "high": float(row["high"]) if row["high"] is not None else None,
        "listing_count": int(row["listing_count"] or 0),
        "active_listing_count": int(row["active_listing_count"] or 0),
        "source": row["source"],
        "coverage_note": row["coverage_note"],
    }


def write_price_cache(item_name, category, payload):
    get_db().execute(
        """
        INSERT INTO price_cache (item_key, category, avg, low, high, listing_count, active_listing_count,
                                 source, coverage_note, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(item_key) DO
        UPDATE SET
            category = excluded.category,
            avg = excluded.avg,
            low = excluded.low,
            high = excluded.high,
            listing_count = excluded.listing_count,
            active_listing_count = excluded.active_listing_count,
            source = excluded.source,
            coverage_note = excluded.coverage_note,
            updated_at = excluded.updated_at
        """,
        (
            cache_key(item_name, category),
            normalize_category(category),
            payload.get("avg"),
            payload.get("low"),
            payload.get("high"),
            int(payload.get("listing_count") or 0),
            int(payload.get("active_listing_count") or 0),
            payload.get("source") or "eBay sold listings",
            payload.get("coverage_note"),
            now_iso(),
        ),
    )
    get_db().commit()


def duplicate_match(user_id, name, low, high, value, image_hash):
    rows = get_db().execute(
        "SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC",
        (user_id,),
    ).fetchall()

    for row in rows:
        similarity = SequenceMatcher(
            None,
            normalized_name(name),
            normalized_name(row["name"]),
        ).ratio()
        image_close = False
        if image_hash and row["image_hash"]:
            distance = hamming_distance(image_hash, row["image_hash"])
            image_close = distance <= 6

        same_price_band = price_ranges_close(row, low, high, value)

        if image_close and similarity >= 0.9:
            return row, "The same exact photo can't be uploaded twice. Put all items of the same type in one clear frame before saving."
        if similarity >= 0.96 and same_price_band:
            return row, "This item already looks like it is in your inventory."
        if image_close and similarity >= 0.84 and same_price_band:
            return row, "This looks like the same saved item from a very similar image."

    return None, None


def remove_image_if_unused(image_url):
    if not image_url:
        return

    refs = get_db().execute(
        "SELECT COUNT(*) AS count FROM items WHERE image_url = ?",
        (image_url,),
    ).fetchone()
    if refs and refs["count"]:
        return

    relative_path = image_url.replace("/static/", "", 1).replace("/", os.sep)
    disk_path = Path(app.static_folder) / relative_path
    if disk_path.exists():
        disk_path.unlink()


def remove_all_user_images(user_id):
    user_dir = app.config["UPLOAD_FOLDER"] / str(user_id)
    if user_dir.exists():
        shutil.rmtree(user_dir)


# Serve frontend
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory("static", path)


# Auth
@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    return jsonify({"user": serialize_user(current_user_row())})


@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = parse_json_body()
    email = normalize_email(data.get("email"))
    password = data.get("password", "")

    if not email:
        return jsonify({"error": "Email is required."}), 400

    password_error = validate_password(password)
    if password_error:
        return jsonify({"error": password_error}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        return jsonify({"error": "An account with that email already exists."}), 409

    created_at = now_iso()
    cursor = db.execute(
        "INSERT INTO users (email, password_hash, created_at, last_login_at) VALUES (?, ?, ?, ?)",
        (email, generate_password_hash(password), created_at, created_at),
    )
    db.commit()

    login_user(cursor.lastrowid)
    user = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify({"user": serialize_user(user)}), 201


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = parse_json_body()
    email = normalize_email(data.get("email"))
    password = data.get("password", "")

    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    timestamp = now_iso()
    get_db().execute("UPDATE users SET last_login_at = ? WHERE id = ?", (timestamp, user["id"]))
    get_db().commit()

    login_user(user["id"])
    user = get_db().execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return jsonify({"user": serialize_user(user)})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


# Identify item via OpenAI Vision
@app.route("/api/identify", methods=["POST"])
def identify():
    data = parse_json_body()
    image_b64 = data.get("image_b64", "")
    mime_type = data.get("mime_type", "image/jpeg")

    if not image_b64:
        return jsonify({"error": "No image provided."}), 400

    try:
        items = call_openai_identify(image_b64, mime_type)
        for item in items:
            coverage_status, coverage_note = assess_coverage(item["name"], item["category"])
            pricing_ready, pricing_note = assess_pricing_detail(item["name"], item["category"])
            if coverage_status != "excluded" and not pricing_ready:
                coverage_status = "review"
                coverage_note = pricing_note
            item["coverage_status"] = coverage_status
            item["coverage_note"] = coverage_note
        return jsonify({"items": items})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/identify-video", methods=["POST"])
def identify_video():
    return jsonify({"error": "Video scanning is disabled for this MVP. Please upload a photo instead."}), 410


# Fetch eBay market prices from sold listings
@app.route("/api/market-price", methods=["POST"])
def market_price():
    data = parse_json_body()
    item_name = (data.get("item_name") or "").strip()
    category = normalize_category(data.get("category"))

    if not item_name:
        return jsonify({"error": "item_name is required"}), 400

    coverage_status, coverage_note = assess_coverage(item_name, category)
    if coverage_status == "excluded":
        return jsonify(
            {
                "avg": None,
                "low": None,
                "high": None,
                "listing_count": 0,
                "active_listing_count": 0,
                "source": "Not claim-eligible",
                "coverage_note": coverage_note,
            }
        )

    pricing_ready, pricing_note = assess_pricing_detail(item_name, category)
    confidence_ceiling = pricing_confidence_ceiling(item_name, category)

    cached = read_price_cache(item_name, category)
    if cached:
        cached["confidence_ceiling"] = confidence_ceiling
        return jsonify(cached)

    if not SERP_API_KEY:
        return jsonify({"error": "Pricing service key is not configured."}), 500

    params = {
        "engine": "ebay",
        "ebay_domain": "ebay.com",
        "_nkw": item_name,
        "LH_Sold": "1",
        "LH_Complete": "1",
        "_sop": "12",
        "api_key": SERP_API_KEY,
    }

    try:
        resp = requests.get("https://serpapi.com/search", params=params, timeout=15)
        resp.raise_for_status()
        results = resp.json()
        active_params = {
            "engine": "ebay",
            "ebay_domain": "ebay.com",
            "_nkw": item_name,
            "_sop": "12",
            "api_key": SERP_API_KEY,
        }
        active_resp = requests.get("https://serpapi.com/search", params=active_params, timeout=15)
        active_resp.raise_for_status()
        active_results = active_resp.json()

        sold_organic = results.get("organic_results", [])
        prices = filtered_prices(item_name, sold_organic)
        active_count = filtered_listing_count(item_name, active_results.get("organic_results", []))

        if not prices:
            payload = {
                "avg": None,
                "low": None,
                "high": None,
                "listing_count": 0,
                "active_listing_count": active_count,
                "source": "No eBay data found",
                "coverage_note": pricing_note or "HomeVault could not find enough matching sold items. Retake the photo so the full item is visible and any identifying details are easier to read.",
                "confidence_ceiling": min(confidence_ceiling, 40),
            }
            return jsonify(payload)

        payload = {
            "avg": round(sum(prices) / len(prices), 2),
            "low": round(min(prices), 2),
            "high": round(max(prices), 2),
            "listing_count": len(prices),
            "active_listing_count": active_count,
            "source": "eBay sold listings" if pricing_ready else "eBay sold listings (broad match)",
            "coverage_note": None if pricing_ready else pricing_note,
            "confidence_ceiling": confidence_ceiling,
        }
        write_price_cache(item_name, category, payload)
        return jsonify(payload)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# Persistent inventory
@app.route("/api/items", methods=["GET"])
@login_required
def get_items():
    rows = get_db().execute(
        "SELECT * FROM items WHERE user_id = ? ORDER BY date DESC, created_at DESC, id DESC",
        (g.current_user["id"],),
    ).fetchall()
    return jsonify({"items": [serialize_item(row) for row in rows]})


@app.route("/api/items", methods=["POST"])
@login_required
def create_item():
    data = parse_json_body()
    name = (data.get("name") or "").strip()
    category = normalize_category(data.get("cat"))

    if not name:
        return jsonify({"error": "Item name is required."}), 400

    value = float(data.get("val") or 0)
    low = float(data.get("low") or value or 0)
    high = float(data.get("high") or value or 0)
    confidence = int(max(0, min(100, data.get("conf", 0) or 0)))
    quantity = int(max(1, min(25, data.get("quantity", 1) or 1)))
    listing_count = int(max(0, data.get("listing_count", 0) or 0))
    active_listing_count = int(max(0, data.get("active_listing_count", 0) or 0))
    image_hash = (data.get("image_hash") or "").strip() or None
    coverage_status, coverage_note = assess_coverage(name, category)
    pricing_ready, pricing_note = assess_pricing_detail(name, category)
    if coverage_status != "excluded" and not pricing_ready:
        coverage_status = "review"
        coverage_note = pricing_note

    if value <= 0:
        return jsonify({"error": "This item needs a clearer photo before it can be saved with a reliable value."}), 400

    duplicate, reason = duplicate_match(
        g.current_user["id"],
        name,
        low,
        high,
        value,
        image_hash,
    )
    if duplicate:
        return (
            jsonify(
                {
                    "error": "Potential duplicate item detected.",
                    "reason": reason,
                    "duplicate": serialize_item(duplicate),
                }
            ),
            409,
        )

    image_url = data.get("image_url")
    if data.get("image_b64"):
        image_url = save_image(data["image_b64"], data.get("mime_type", "image/jpeg"), g.current_user["id"])

    timestamp = now_iso()
    cursor = get_db().execute(
        """
        INSERT INTO items (user_id, name, cat, val, low, high, conf, emoji, date,
                           condition, image_url, image_hash, price_source, quantity, listing_count,
                           active_listing_count,
                           coverage_status, coverage_note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            g.current_user["id"],
            name,
            category,
            value,
            low,
            high,
            confidence,
            (data.get("emoji") or "").strip() or default_emoji(category),
            (data.get("date") or "").strip() or datetime.utcnow().date().isoformat(),
            int(max(10, min(100, data.get("condition", 85) or 85))),
            image_url,
            image_hash,
            data.get("price_source") or "eBay sold listings",
            quantity,
            listing_count,
            active_listing_count,
            coverage_status,
            coverage_note,
            timestamp,
            timestamp,
        ),
    )
    get_db().commit()

    row = get_db().execute("SELECT * FROM items WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify({"item": serialize_item(row)}), 201


@app.route("/api/items", methods=["DELETE"])
@login_required
def delete_all_items():
    total = get_db().execute(
        "SELECT COUNT(*) AS count FROM items WHERE user_id = ?",
        (g.current_user["id"],),
    ).fetchone()
    deleted_count = int(total["count"] or 0)

    get_db().execute("DELETE FROM items WHERE user_id = ?", (g.current_user["id"],))
    get_db().commit()
    remove_all_user_images(g.current_user["id"])

    return jsonify({"ok": True, "deleted_count": deleted_count})


@app.route("/api/items/<int:item_id>", methods=["PATCH"])
@login_required
def update_item(item_id):
    data = parse_json_body()
    condition = int(max(10, min(100, data.get("condition", 85) or 85)))

    row = get_db().execute(
        "SELECT * FROM items WHERE id = ? AND user_id = ?",
        (item_id, g.current_user["id"]),
    ).fetchone()
    if not row:
        return jsonify({"error": "Item not found."}), 404

    timestamp = now_iso()
    get_db().execute(
        "UPDATE items SET condition = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        (condition, timestamp, item_id, g.current_user["id"]),
    )
    get_db().commit()

    row = get_db().execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return jsonify({"item": serialize_item(row)})


@app.route("/api/items/<int:item_id>", methods=["DELETE"])
@login_required
def delete_item(item_id):
    row = get_db().execute(
        "SELECT * FROM items WHERE id = ? AND user_id = ?",
        (item_id, g.current_user["id"]),
    ).fetchone()
    if not row:
        return jsonify({"error": "Item not found."}), 404

    image_url = row["image_url"]
    get_db().execute("DELETE FROM items WHERE id = ? AND user_id = ?", (item_id, g.current_user["id"]))
    get_db().commit()
    remove_image_if_unused(image_url)

    return jsonify({"ok": True})


# Generate insurance PDF
@app.route("/api/generate-pdf", methods=["POST"])
def generate_pdf():
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
        import io

        data = parse_json_body()
        items = data.get("items", [])
        total = float(data.get("total", 0) or 0)

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        styles = getSampleStyleSheet()
        story = []

        story.append(Paragraph("HomeVault - Insurance Report", styles["Title"]))
        story.append(Paragraph(f"Generated: {datetime.now().strftime('%B %d, %Y')}", styles["Normal"]))
        story.append(Spacer(1, 20))
        story.append(Paragraph(f"Total Home Value: ${total:,.2f}", styles["Heading2"]))
        story.append(Paragraph("Pricing source: eBay sold listings", styles["Normal"]))
        story.append(Spacer(1, 20))

        table_data = [["Item", "Category", "Qty", "Market Value", "Confidence", "Scan Date"]]
        for item in items:
            qty = int(item.get("quantity", 1) or 1)
            label = item.get("name", "")
            if item.get("coverage_status") == "review":
                label = f"{label} *"
            table_data.append(
                [
                    label,
                    item.get("cat", ""),
                    str(qty),
                    f"${(item.get('val', 0) or 0) * qty:,.0f}",
                    f"{item.get('conf', 0)}%",
                    item.get("date", ""),
                ]
            )

        t = Table(table_data, colWidths=[160, 90, 45, 95, 70, 80])
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, 0), 10),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f8")]),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#ddddee")),
                    ("FONTSIZE", (0, 1), (-1, -1), 9),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(t)
        story.append(Spacer(1, 20))
        story.append(
            Paragraph(
                "This report was generated by HomeVault using image identification and eBay sold listings for market pricing.",
                styles["Normal"],
            )
        )
        if any(item.get("coverage_status") == "review" for item in items):
            story.append(Spacer(1, 8))
            story.append(
                Paragraph(
                    "* Items marked with an asterisk may need insurer review. Their estimates are shown for reference and are not included in the claimable total.",
                    styles["Normal"],
                )
            )

        doc.build(story)
        buffer.seek(0)

        return send_file(
            buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"homevault-report-{datetime.now().strftime('%Y%m%d')}.pdf",
        )
    except ImportError:
        return jsonify({"error": "Install reportlab: pip install reportlab"}), 500
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port, debug=False)
