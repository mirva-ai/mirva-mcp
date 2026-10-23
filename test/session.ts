/**
 * How a session decides that Mirva has answered, tested against a fake channel.
 *
 * A turn is over when its reply arrives. A wrong rule here either hangs the caller until the timeout or hands back
 * a message from before the request as if it were the answer, so each case below is one of those two ways to fail.
 *
 * Run: node test/session.ts
 */
import { MirvaSession, ToolOutput, type ChatMessage, type Mirva } from '../packages/sdk/src/index.ts';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name} — got ${String(actual)}, wanted ${String(expected)}`);
  }
}

const ME = 'user-me';
const MIRVA = 'user-mirva';

/**
 * A channel that already holds `before`, takes the request as message "req", and then shows one more of `after` on
 * each read, as a turn's messages arrive over time.
 */
function fakeSession(before: ChatMessage[], after: ChatMessage[]): MirvaSession {
  const channel = [...before];
  const pending = [...after];
  const answer = (value: unknown) => Promise.resolve(new ToolOutput({ type: 'text', text: JSON.stringify(value) }));
  const tools = {
    send_message: () => {
      channel.push({ _id: 'req', userId: ME, message: 'paint it', createdAt: '' });
      return answer({ messageId: 'req' });
    },
    get_messages: () => {
      const next = pending.shift();
      if (next) channel.push(next);
      return answer(channel);
    },
  };
  return new MirvaSession({ tools } as unknown as Mirva, 'ai-session/test');
}

const message = (id: string, userId: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ _id: id, userId, message: id, createdAt: '', ...extra });

async function reply(session: MirvaSession) {
  return session.ask('paint it', { pollMs: 1, timeoutMs: 2_000 });
}

console.log('with replyTo (a server that reports it)');
{
  const result = await reply(fakeSession(
    [message('old', MIRVA, { replyTo: 'earlier' })],
    [message('note', MIRVA, { replyTo: 'someone-else' }), message('answer', MIRVA, { replyTo: 'req' })],
  ));
  check('the reply is the message answering the request', result.reply._id, 'answer');
  check('a reply to another request does not end the turn', result.messages.length, 2);
}
{
  const result = await reply(fakeSession([], [message('mine', ME, { replyTo: 'x' }), message('answer', MIRVA, { replyTo: 'req' })]));
  check('messages before the reply are reported in order', result.messages.map(m => m._id).join(','), 'mine,answer');
}

console.log('without replyTo (an older server)');
{
  const result = await reply(fakeSession([message('old', MIRVA)], [message('answer', MIRVA)]));
  check('a message from before the request is never the reply', result.reply._id, 'answer');
}
{
  const result = await reply(fakeSession([], [message('follow-up', ME), message('answer', MIRVA)]));
  check('my own later message does not end the turn', result.reply._id, 'answer');
}

console.log('waiting');
{
  const session = fakeSession([], []);
  let error = '';
  try {
    await session.ask('paint it', { pollMs: 1, timeoutMs: 30 });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  check('no reply ends in a timeout, not a hang', error.startsWith('No reply to req'), true);
}
{
  const session = fakeSession([], []);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('stopped')), 20);
  let error = '';
  try {
    await session.ask('paint it', { pollMs: 5, timeoutMs: 5_000, signal: controller.signal });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  check('an abort ends the wait with its reason', error, 'stopped');
}

console.log(failures ? `\n${failures} session check(s) failed` : '\nall session checks pass');
process.exit(failures ? 1 : 0);
