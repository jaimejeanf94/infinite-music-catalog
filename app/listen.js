// listen.js — where the Apple Music and Spotify buttons point.
//
// An album with a known Apple Music link opens that album; anything else opens
// a search. On a phone the difference is bigger than it looks. music.apple.com
// and open.spotify.com are both verified Android app links, so an album page
// hands off to the app -- but a search page is not something either app
// promises to accept, which is how a tap on "Apple Music" ended up in the web
// player. On Windows no web link reaches a desktop app at all, so the most
// that can be done there is to land on the right album rather than a search.
//
// A Mac is different again: the browser keeps https links for itself, but the
// Music app claims its own music:// scheme, so there the album link is written
// in that form and opens the app directly. The browser asks once before
// handing it over.
//
// Kept free of React, like genres.js, so the nightly scripts judge a link with
// exactly the rule the album sheet uses.

// One album on Apple Music: music.apple.com/<storefront>/album/<name>/<id>.
// A song link is the same URL with ?i=<track id>, and an artist link has no
// /album/ in it; neither is what a button labelled with the album promises.
function isAppleAlbumUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "music.apple.com" &&
      /^\/[a-z]{2}\/album\/./.test(u.pathname) && !u.searchParams.has("i");
  } catch {
    return false;
  }
}

const query = (album) => encodeURIComponent(`${album.artist} ${album.title}`);

// A Mac, but not an iPad: iPadOS reports itself as a Mac to get desktop sites,
// and an iPad already opens music.apple.com album links in the app. The touch
// screen is what gives it away. False outside a browser -- tested on window,
// because recent Node has a navigator of its own that reports the machine
// it runs on.
function onMac() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  return /mac/i.test(platform) && !(navigator.maxTouchPoints > 1);
}

// Each returns the link, whether it is the album itself -- so the button can
// say "Apple Music" when it opens the record and "Search Apple Music" when it
// cannot promise to -- and whether it belongs in a new tab. An app link does
// not: opened in a new tab, the browser hands it to the app and leaves an
// empty tab behind.
const Listen = {
  isAppleAlbumUrl,
  apple(album) {
    if (!isAppleAlbumUrl(album.apple_music_url)) {
      return { href: `https://music.apple.com/search?term=${query(album)}`, exact: false, newTab: true };
    }
    return onMac()
      ? { href: album.apple_music_url.replace(/^https:\/\//, "music://"), exact: true, newTab: false }
      : { href: album.apple_music_url, exact: true, newTab: true };
  },
  spotify(album) {
    return { href: `https://open.spotify.com/search/${query(album)}`, exact: false, newTab: true };
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = Listen;
else window.Listen = Listen;
