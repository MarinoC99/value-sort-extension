# Privacy

## What the extension stores, and where

Everything stays in the user's browser, in `chrome.storage.local`:

- **Settings** (key `avs`): the quality/price weighting, whether sorting is on, the
  minimum review count, whether sponsored results are dimmed, the "trust after" review
  count, and whether the panel is collapsed.
- **Basis memory** (key `avsBasis`): for each of the last 200 searches, the site and
  search term (for example `www.amazon.com|hand soap`), the price basis used (mass,
  volume, count, length or area), and when it was last used. Older entries are dropped.
  A search that ends up on list price is removed rather than stored.

The extension makes no network requests. It reads only the Amazon search page the user
has open, and changes only the order and styling of the results already on it. Nothing
is sent to the developer or anyone else, and there is no analytics.

Removing the extension deletes this storage.

## Why the data-usage form is answered "none"

The store's form asks what user data the extension *collects*. As far as I can tell,
data processed and stored only on the user's device and never transmitted is not
collection in the store's sense, so no category applies. **This rests on my reading of
the policy, not a confirmed answer: check the form's current wording before
submitting.** If the form treats locally stored search terms as collected, the closest
category is "Web history" or "User activity". Ticking it is safer than arguing the
point, and it doesn't change what the extension does.

## Privacy policy text

The store asks for a policy URL when user data is handled, and having one costs nothing
even if it isn't required. This text is ready to host as a page:

> **Value Sort for Amazon: privacy policy**
>
> Value Sort for Amazon does not collect, transmit, sell or share any personal data. It
> makes no network requests and contains no analytics.
>
> To work, it stores two things in your browser's extension storage: your settings, and,
> for each of your last 200 Amazon searches, the search term and which price basis
> (per-unit or list price) was used. This keeps a search from switching basis between
> visits. That information never leaves your browser and is deleted when you remove the
> extension.
>
> The extension runs only on Amazon search pages, reads only the results already on the
> page, and changes only their order and appearance.
>
> Questions: [contact address of your choice]
>
> Last updated: [date of publishing]
