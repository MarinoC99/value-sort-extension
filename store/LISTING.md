# Chrome Web Store listing

Copy for the store's listing and privacy forms. Field names follow the developer
dashboard. Upload `dist/value-sort-extension-<version>.zip` from `npm run package`.

## Store listing

**Name:** Value Sort for Amazon

**Summary** (132 characters max; same as the manifest description):

> Re-sort Amazon search results by a tunable blend of review quality and price.

**Category:** Shopping

**Language:** English

**Description:**

> Value Sort re-orders the Amazon search results already on the page by a score you
> control: a blend of review quality and price. A slider sets the weighting, from
> quality only to price only.
>
> Review quality is not the raw star average. A 4.9 from six reviews is mostly noise, so
> ratings with few reviews are pulled toward a typical rating, and well-reviewed products
> keep their own average. An advanced setting controls how sceptical it is.
>
> Price uses the per-unit price Amazon shows on each result ("$0.52/Count", "$0.30/Fl Oz")
> when most results on the page share a unit, so a large pack is compared fairly with a
> small one. Otherwise it uses the list price. The panel always says which it chose. Where
> a result has no per-unit price, one is estimated from the title and marked "est"; those
> estimates are worth a glance before trusting.
>
> Sponsored results and products below a review count you choose can be dimmed and moved
> down, as are results that can't be priced on the page's basis (pods on a search ranked
> by weight, for example). Nothing is removed, and switching sorting off restores
> Amazon's order.
>
> Limits: it ranks only the results loaded on the current page, not the whole search.
> Prices are the price shown on the result, not including coupons applied at checkout.
>
> Privacy: nothing is fetched or sent anywhere. The extension reads only the search page
> you have open. Your settings, and the last 200 searches' price basis, are stored in your
> browser and never leave it.
>
> Works on amazon.com, amazon.co.uk, amazon.ca, amazon.com.au, amazon.in and amazon.sg,
> in English.
>
> Independent project. Not affiliated with or endorsed by Amazon.

**Graphic assets still needed:** at least one screenshot (1280×800 or 640×400). The
promotional tile (440×280) is optional. The store icon is `icons/icon128.png`.

## Privacy practices tab

**Single purpose:**

> Re-orders the Amazon search results already on the page by a user-weighted blend of
> review quality and price.

**Permission justification, `storage`:**

> Saves the user's settings (the quality/price weighting and display options) and, for
> each of the last 200 searches, which price basis was used, so a search does not flip
> between per-unit and list price from one load to the next. Stored locally with
> chrome.storage.local; never transmitted.

**Host permission justification** (content script on Amazon sites):

> The extension's only function is to read and re-order the search results on Amazon
> search pages, so its content script must run on those pages. It loads on six English
> Amazon sites and nowhere else, does nothing on pages without search results, and makes
> no network requests.

**Are you using remote code?** No. All code ships in the package; nothing is fetched,
evaluated or injected from elsewhere.

**Data usage:** tick none of the data categories. See PRIVACY.md for why, and check that
reasoning against the form's current wording before submitting.

**Certifications** (all true):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single
  purpose.
- I do not use or transfer user data to determine creditworthiness or for lending
  purposes.

**Privacy policy URL:** see PRIVACY.md.
