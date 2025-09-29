import { Yabai, z } from '../src/index.js';

const bot = new Yabai({
    pairing: { number: '827372324' } //change this to your number
});

bot.cmd(
    'sum :a :b',
    z.object({ a: z.coerce.number(), b: z.coerce.number() }),
    async ({ params, msg }) => {
        //params.a and params.b is a number
        await msg.reply(`The sum is ${params.a + params.b}`);
    },
    { description: 'Calculates the sum of two numbers' }
);

bot.connect().catch((err) => console.error(err));
