Smart Home Inventory and Market Valuation (HomeVault)
Quick Start
1. Project layout
texthomevault/
|-- app.py
|-- .env
|-- requirements.txt
|-- homevault.db            # created automatically on first run
`-- static/
    |-- index.html
    |-- css/styles.css
    `-- js/
        |-- app.js
        |-- dashboard.js
        |-- scan.js
        |-- inventory.js
        |-- analytics.js
        `-- charts.js
2. Add your API keys
Update .env:
bashOPENAI_API_KEY=your_openai_api_key_here
SERP_API_KEY=your_ebay_pricing_key_here
SECRET_KEY=optional_override_for_hosted_deployments
3. Install dependencies
bashpip install -r requirements.txt
4. Run the app
bashpython app.py
Open http://localhost:5000.
What Changed

Photo scans can now detect multiple important items in one image.
Every saved scanned item stores an image path in SQLite so thumbnails survive refresh and re-login.
Accounts use email plus hashed passwords with minimum length, uppercase, lowercase, number, and symbol rules.
Duplicate protection checks image similarity plus name and price overlap before saving.
Dashboard, analytics, and report screens all render meaningful empty states instead of disappearing.
Video scanning is intentionally disabled for MVP stability. The backend returns a clear message if /api/identify-video is called.
If SECRET_KEY is not set, HomeVault generates a strong local one-time secret in .homevault_secret so shared sessions stay secure across restarts.

API Endpoints
EndpointMethodDescription/api/auth/registerPOSTCreate an account and start a session/api/auth/loginPOSTSign in and restore saved inventory/api/auth/logoutPOSTEnd the current session/api/auth/meGETFetch the active signed-in user/api/identifyPOSTDetect one or more items from an uploaded image/api/market-pricePOSTFetch eBay sold prices/api/itemsGETLoad saved items for the signed-in user/api/itemsPOSTSave a detected item with duplicate checking/api/items/<id>PATCHUpdate item condition/api/items/<id>DELETERemove an item/api/generate-pdfPOSTGenerate the insurance report PDF
Notes

SQLite and the static/uploads/ folder are created automatically on first run.
.homevault_secret is created automatically when needed and is ignored by .gitignore.
Saved inventory is tied to the email account used to sign in.
OpenAI Vision powers identification, and live eBay sold-listing prices power valuation.
