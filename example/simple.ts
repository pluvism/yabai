import { Yabai } from '../src/index.js'

// qrcode is print on terminal by default.
// with qrcode.small = true, timeout 60 seconds
// if you wish to use pairing, see params-command.ts example
new Yabai()
    .cmd('ping', 'Pong!')
    .connect(() => console.log('Bot Connected!'))
    .catch((e) => console.log('Simple bot error:', e))
