import { Yabai } from '../src/index.js'


new Yabai()
    .cmd('ping', 'Pong!')
    .connect()
    .catch((e) => console.log('Simple bot error:', e))