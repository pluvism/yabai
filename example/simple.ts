import { Yabai } from '../src/index.js'

new Yabai()
    .cmd('ping', 'Pong!')
    .connect(() => console.log('Bot Connected!'))
    .catch((e) => console.log('Simple bot error:', e))
