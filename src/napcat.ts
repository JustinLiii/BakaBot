import { NCWebsocket, Structs, type SendMessageSegment } from 'node-napcat-ts'

const napcat = new NCWebsocket({
  protocol: 'ws',
  host: '127.0.0.1',
  port: 11451,
  accessToken: 'IIaEzKZltGMNauLM',
  // 是否需要在触发 socket.error 时抛出错误, 默认关闭
  throwPromise: true,
  // ↓ 自动重连(可选)
  reconnection: {
    enable: true,
    attempts: 10,
    delay: 5000
  }
  // ↓ 是否开启 DEBUG 模式
}, false)

export {napcat}