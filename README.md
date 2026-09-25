# StreamHub / TeslaPlay

A touch-friendly static entertainment dashboard for Live TV, YouTube, Twitch, web radio, games, and the built-in arcade.

## Free GitHub Pages hosting

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select the `main` branch and the `/ (root)` folder, then save.
4. Open `https://silverliner2.github.io/streamhub/` after GitHub finishes publishing.

The site is packaged as plain static files and uses relative asset paths, so it works from the repository subpath without a build server, database, account system, or paid API. The supplied StreamTV M3U is bundled as `streamtv.m3u` and loads on first launch.

## Notes

YouTube pasted links work without an API key. YouTube search and category browsing are optional and require the user to enter their own free YouTube Data API key in the browser; the key is stored only in localStorage. Twitch and YouTube embeds may be restricted while the vehicle is moving, depending on browser and service policies. Live TV and radio use native browser media where the stream permits it.

The playlist manager supports local persistence, custom M3U add/edit/remove, dedicated MLB/NBA/NHL playlist prompts, and browser-side refresh for remote playlists while Live TV is open.
