import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Injectable, Logger } from "@nestjs/common";

// Single broadcaster for live plan/chat state. iOS connects with URLSessionWebSocketTask via the
// Socket.IO protocol-compatible client; clients `join` a thread room and receive:
//   message.created · plan.updated · audit.created
@Injectable()
@WebSocketGateway({ cors: { origin: "*" } })
export class RealtimeGateway {
  private readonly log = new Logger("Realtime");
  @WebSocketServer() server!: Server;

  @SubscribeMessage("join")
  onJoin(@MessageBody() data: { threadId: string }, @ConnectedSocket() client: Socket) {
    if (data?.threadId) {
      client.join(`thread:${data.threadId}`);
      this.log.debug(`socket ${client.id} joined thread:${data.threadId}`);
    }
    return { ok: true };
  }

  emitToThread(threadId: string, event: string, payload: unknown) {
    this.server?.to(`thread:${threadId}`).emit(event, payload);
  }
}
