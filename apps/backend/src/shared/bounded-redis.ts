import { Redis } from 'ioredis'

/** Refuse new work before a silent Redis peer can retain an unbounded command queue. */
export class BoundedRedis extends Redis {
  override sendCommand(...args: Parameters<Redis['sendCommand']>): unknown {
    const [command] = args
    if (this.commandQueue.length >= 1_024) {
      command.reject(new Error('REDIS_CAPACITY_EXCEEDED'))
      return command.promise
    }
    return super.sendCommand(...args)
  }
}
