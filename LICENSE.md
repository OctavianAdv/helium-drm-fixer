# License

**Helium DRM Fixer** is free and open-source software, released under the **MIT License**.

- [The license in plain words](#the-license-in-plain-words)
- [MIT License (full text)](#mit-license)
- [About Widevine](#about-widevine)
- [Third-party software](#third-party-software)
- [Trademarks](#trademarks)
- [No warranty](#no-warranty)

---

## The license in plain words

*This summary is for convenience only. The [full license text](#mit-license) below is what legally applies.*

| You **can** | You **must** | We **are not** |
| --- | --- | --- |
| ✅ Use it for free, privately or commercially | 📄 Keep the copyright notice and license text in copies or substantial portions of the code | ⚠️ Responsible if something goes wrong; it comes "as is", without warranty |
| ✅ Read, study and change the code | | ⚠️ Promising it works with any particular streaming service |
| ✅ Share it, and share your changed versions | | |
| ✅ Include it in other projects, open or closed source | | |

---

## MIT License

```text
MIT License

Copyright (c) 2026 OctavianAdv

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The same text is in [`LICENSE.txt`](LICENSE.txt).

---

## About Widevine

The **Widevine Content Decryption Module (CDM)** is proprietary software owned by **Google LLC**. It is **not** covered by this license, and it is **not** included in this repository or in the release executables.

What the tool does:

- **Copies** a Widevine CDM that already exists on the user's own computer (installed there by Chrome, Edge, Firefox, Spotify or another program the user installed) into the user's own Helium installation.
- **Downloads** Google Chrome only when no Widevine exists on the computer. On Windows it uses a public mirror of Google's official offline installer; on Linux, Google's official package from `dl.google.com`. The tool then takes Widevine from that download, on the user's machine.

Use of Widevine remains subject to Google's terms, and use of streaming services remains subject to each service's terms. You are responsible for using this tool in line with the terms and laws that apply to you.

---

## Third-party software

The release executables are built with [Bun](https://bun.sh/) and contain the following third-party software. Each is the property of its authors and is used under its own license.

| Component | Used for | License | Source |
| --- | --- | --- | --- |
| **Bun** | JavaScript runtime embedded in each executable | MIT (includes JavaScriptCore, under LGPL-2.1) | [github.com/oven-sh/bun](https://github.com/oven-sh/bun) |
| **7-Zip** (`7za.exe` 19.00) | Unpacking the Chrome installer on Windows | GNU LGPL-2.1 | [7-zip.org](https://www.7-zip.org/) |
| **7zip-bin** | Supplies the `7za` binaries | MIT | [github.com/develar/7zip-bin](https://github.com/develar/7zip-bin) |
| **@agent-infra/browser-finder** | Locating installed Chrome | Apache-2.0 | [github.com/agent-infra/browser](https://github.com/agent-infra/browser) |
| **commander** | Command-line options | MIT | [github.com/tj/commander.js](https://github.com/tj/commander.js) |
| **chalk** | Coloured output | MIT | [github.com/chalk/chalk](https://github.com/chalk/chalk) |
| **ora** | Progress spinners | MIT | [github.com/sindresorhus/ora](https://github.com/sindresorhus/ora) |
| **pino** / **pino-pretty** | `--verbose` logging | MIT | [github.com/pinojs/pino](https://github.com/pinojs/pino) |
| **zod** | Dependency of the above | MIT | [github.com/colinhacks/zod](https://github.com/colinhacks/zod) |

**7-Zip notice.** 7-Zip is Copyright (C) 1999-2018 Igor Pavlov and is distributed under the GNU Lesser General Public License, version 2.1. The unmodified `7za.exe` is embedded in the Windows executable and written to a temporary folder only when Chrome must be unpacked. Its source code is available from [7-zip.org](https://www.7-zip.org/download.html).

The full license text of each npm package is in its folder under `node_modules/` after running `bun install`.

---

## Trademarks

Helium is a product of imput. Widevine, Google Chrome and Chromium are trademarks of Google LLC. Microsoft Edge, Windows and WebView2 are trademarks of Microsoft Corporation. Firefox is a trademark of the Mozilla Foundation. Brave, Opera, Vivaldi, Spotify and all other names are trademarks of their respective owners.

They are used here only to describe compatibility. This project is **independent** and is not affiliated with, endorsed by, or sponsored by any of these companies or by any streaming service.

---

## No warranty

As the license says, the software is provided **"as is"**, without warranty of any kind. DRM support ultimately depends on Helium, on the Widevine module and on each streaming service's own requirements, none of which this project controls.
