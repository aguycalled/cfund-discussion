# cfund-discussion

A simple forum for the discussion of [NavCoin](www.navcoin.org) Community Fund Proposals.  
Users must register a staking NavCoin address in order to be able to comment.

Hosted at [communityfund.nav.community](communityfund.nav.community).

## Running the server

- Clone down the repo
- Create your own `config.js` (See [config.js.sample](config.js.sample))
- Run: `npm i`
- Launch mongodb
- The server can be run in Production Mode or Development Mode
  - To run in Production Mode, run `npm run prod`
  - To run in Development Mode, run `npm run dev`

Development Mode turns off reCaptcha.