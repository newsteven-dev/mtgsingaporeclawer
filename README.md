# MTG SG Price Compare

Type a Magic: The Gathering card name and compare its singles prices across five Singapore stores:

| Store | How prices are read |
| --- | --- |
| [Agora Hobby](https://agorahobby.com/) | Server-rendered store search page (`/store/search?category=mtg`) |
| [MTG Asia](https://mtg-asia.com/) | The same public inventory query the storefront's search box makes |
| [Mox & Lotus](https://moxandlotus.sg/) | The storefront's JSON product search (`/api/products?search=`) |
| [The TCG Marketplace](https://thetcgmarketplace.com/) | The storefront's product filter API (`:3501/product/filter`), lowest seller price |
| [Grey Ogre Games](https://www.greyogregames.com/) | Shopify search results (`title:"<card>"`), per-condition variants |

Card-name autocomplete and card details (image, type line, USD reference price) come from the
[Scryfall API](https://scryfall.com/docs/api). Every card also links to its
[Gatherer](https://gatherer.wizards.com/) page. (Gatherer has no public API, so Scryfall supplies the suggestions.)

## Run it

Requires Node.js 20.12 or newer.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. Add `?card=Lightning%20Bolt` to the URL to link straight to a card.

## Card Kingdom prices

Each card page also shows what [Card Kingdom](https://www.cardkingdom.com/) **sells** every version of the card for
(edition, variation, foil or non-foil), with the price and stock for each condition. Versions Card Kingdom has sold out
of are hidden by default.

- Card Kingdom grades cards NM, EX, VG and G, roughly the same as NM, LP, MP and HP at the Singapore stores.
  The **From** column is the cheapest condition that's in stock.
- The headline shows Card Kingdom's cheapest in-stock copy and how the cheapest Singapore copy compares.
  When the set names match, it also compares the same printing and condition as the cheapest Singapore copy.
- Prices come from Card Kingdom's public daily price list (`api.cardkingdom.com/api/v2/pricelist`, about 68 MB).
  The server streams it once, keeps a slim copy in memory (about 220 MB of RAM), and refreshes it every 6 hours.
  The first Card Kingdom lookup after the server starts takes a few seconds.
- USD prices are converted to SGD with the daily rate from [Frankfurter](https://frankfurter.dev).
  Set `USD_SGD_RATE` to use a fixed rate instead. Prices don't include shipping from the US.

## Price history (Supabase)

Every fresh price check is saved to Supabase, so the app can chart how each store's cheapest
in-stock price for a card changes over time and list recently tracked cards on the home page.

1. Copy `.env.example` to `.env`.
2. In the Supabase dashboard for the `mtgsingaporeclawer` project, open **Project Settings → API Keys**,
   create or copy a **secret key** (`sb_secret_...`) and paste it as `SUPABASE_SECRET_KEY`.
3. Restart the app. The console prints `Price history: saving to Supabase`.

The secret key stays on the server and is never sent to the browser. Without it the app still
works; price history is just turned off.

The database schema is in `supabase/migrations/` and is already applied to the project:

- `price_snapshots`: one row per card and store check, with the cheapest in-stock price overall, non-foil and foil.
- `price_listings`: the in-stock listings captured with each snapshot.
- `card_price_daily` (view): the cheapest price per card, store and day (Singapore time).
- `trending_cards` (view): cards checked in the last 30 days, with the cheapest price now and 7 days ago.

All tables have Row Level Security turned on with no public policies, so only the server's secret key can read or write them.
Results are cached for 10 minutes, so a card searched repeatedly is saved at most once per store every 10 minutes.

## Sign in with GitHub: captured searches

`/login.html` signs you in with your GitHub account (through Supabase Auth). Once signed in,
`/searches.html` shows every search captured so far: a list of cards tracked, and a search log where
each row expands to show what every store had at that moment (in-stock count, cheapest prices and listings).
**Top searches** ranks the 20 most searched cards per day or per month, as a bar chart or a table.
The main page has no visible sign-in button: go to `/login.html` directly. Once you are signed in, the top-right corner
shows **Captured searches** and **Log out**, and the main page also shows **Recently tracked cards** and each card's
**Price history**. Signed out, those stay hidden (the server refuses that data without a valid sign-in), while the live
price comparison keeps working for everyone.

Only the GitHub accounts whose **verified email** is listed in `ADMIN_EMAILS` can see this data. If `ADMIN_EMAILS`
is empty, the GitHub usernames in `ADMIN_GITHUB_USERS` (default `newsteven-dev`) decide instead. Set `ADMIN_EMAILS`
in the Render dashboard (**Environment** tab) rather than in the repo, so the address isn't published. The server
checks every request with Supabase, so another GitHub user who signs in just sees "not allowed".

### One-time setup

1. **Create a GitHub OAuth app.** On GitHub go to **Settings → Developer settings → OAuth Apps → New OAuth App**.
   - Application name: `MTG SG Price Compare`
   - Homepage URL: your site, e.g. `https://mtg-sg-price-compare.onrender.com`
   - Authorization callback URL: `https://dlkknzbftscwktzzpwcn.supabase.co/auth/v1/callback`

   Click **Register application**, then **Generate a new client secret**. Keep the Client ID and the secret.
2. **Turn on GitHub in Supabase.** In the Supabase dashboard open **Authentication → Sign In / Providers → GitHub**,
   switch it on, paste the Client ID and Client Secret, and save.
3. **Allow the redirect back to the app.** In **Authentication → URL Configuration**, set **Site URL** to your site,
   and add these under **Redirect URLs**:
   - `https://mtg-sg-price-compare.onrender.com/**` (your Render address)
   - `http://localhost:3000/**` (for running it on your computer)
4. Make sure the server has `SUPABASE_PUBLISHABLE_KEY` set. It's already in `render.yaml` and `.env.example`.

## Put it on the internet (Render)

The repo includes a `render.yaml`, so [Render](https://render.com) can set everything up from it.

1. Sign up at https://render.com with your GitHub account.
2. Click **New → Blueprint**, choose the `mtgsingaporeclawer` repository and click **Connect**.
3. Render reads `render.yaml` and asks for `SUPABASE_SECRET_KEY`. Paste your `sb_secret_...` key and click **Apply**.
4. After a few minutes the app is live at an address like `https://mtg-sg-price-compare.onrender.com`.
   Render redeploys automatically every time `main` changes.

Notes:

- The free plan sleeps after about 15 minutes without visitors, so the first visit after that takes 30–60 seconds to load.
  Upgrade the service to a paid instance in Render to keep it always on.
- The service runs in Render's Singapore region, close to the shops.
- Each visitor is limited to about 40 card searches per 10 minutes (`SEARCHES_PER_10_MIN`) so the public site can't be used to flood the shops.

Any host that runs Node.js works the same way: build with `npm ci`, start with `npm start`, and set the
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` environment variables.

## How it works

- `public/` is the web page. While you type, it asks `/api/autocomplete` for suggestions (debounced; ↑/↓, Tab and Enter work).
- When you pick a card, the page sends one `/api/prices?store=<id>&name=<card>` request per store in parallel, so each store's tile fills in as soon as that store answers.
- `src/stores/*.js` holds one adapter per shop. Each returns listings shaped like
  `{ title, set, setCode, condition, finish, price, stock, inStock, url, image }`.
  Titles are matched exactly against the Scryfall card name (so `Lightning Bolt` doesn't pull in `Chain Lightning`).
- Results are cached in memory for 10 minutes (`CACHE_MINUTES`). The **Refresh prices** button skips the cache.

### API

| Endpoint | Description |
| --- | --- |
| `GET /api/stores` | Configured stores |
| `GET /api/autocomplete?q=bolt` | Card-name suggestions (Scryfall) |
| `GET /api/card?name=Lightning%20Bolt` | Card details (Scryfall) |
| `GET /api/prices?store=agora&name=Lightning%20Bolt[&refresh=1]` | Listings at one store (fresh results are saved to Supabase) |
| `GET /api/cardkingdom?name=Lightning%20Bolt` | Card Kingdom retail prices and stock for every version and condition |
| `GET /api/history?name=Lightning%20Bolt&days=90` | Daily cheapest price per store (signed-in allowlisted user only) |
| `GET /api/trending` | Recently tracked cards with price change vs 7 days ago (signed-in allowlisted user only) |
| `GET /api/config` | Public sign-in settings (Supabase URL and publishable key) |
| `GET /api/admin/searches?q=&limit=&offset=` | Captured searches and cards (signed-in allowlisted user only) |
| `GET /api/admin/top?period=day\|month&start=YYYY-MM-DD` | Top 20 searched cards for a day or month (signed-in allowlisted user only) |
| `GET /api/admin/snapshots?ids=1,2` | Store snapshots and listings for one search (signed-in allowlisted user only) |

Store ids: `agora`, `mtgasia`, `moxandlotus`, `tcgmarketplace`, `greyogre`.

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `SUPABASE_URL` | none | Supabase project URL (turns on price history) |
| `SUPABASE_SECRET_KEY` | none | Supabase secret or service_role key, server only |
| `SUPABASE_PUBLISHABLE_KEY` | none | Supabase publishable key, used by the GitHub sign-in page |
| `ADMIN_EMAILS` | none | Verified GitHub emails allowed to see captured searches (comma-separated); when set, decides access |
| `ADMIN_GITHUB_USERS` | `newsteven-dev` | GitHub usernames allowed to see captured searches, used only when `ADMIN_EMAILS` is empty |
| `CACHE_MINUTES` | `10` | How long price results are cached |
| `SEARCHES_PER_10_MIN` | `40` | Card searches allowed per visitor every 10 minutes |
| `USD_SGD_RATE` | daily rate | Fixed USD to SGD rate for Card Kingdom prices |
| `TCG_API_URL` | `https://thetcgmarketplace.com:3501/` | TCG Marketplace API base |
| `TCG_MTG_CATEGORY_ID` | auto-detected | Skip the category lookup |
| `MTGASIA_APP_ID` | value from the site | MTG Asia storefront app id |

## Tests

```bash
npm test
```

The tests cover the parsers and name matching using small HTML/JSON fixtures, so they need no network access.

## Notes

- Prices are in SGD as each store lists them. Stores change their sites, so an adapter may break and need updating; when that happens its tile shows the error and a link to search the store directly.
- Please use this tool reasonably. It makes a few requests per store per search and caches results to keep load on the shops light.
