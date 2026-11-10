/**
 * Message bridge to the desktop host (desktop/visualizer.py). In the desktop app both the
 * visualizer and the settings window are WebKitGTK views; messages travel through the host.
 * In a normal browser `isDesktop` is false and nothing here does anything.
 */
interface Handler {
  postMessage(message: string): void;
}

const handler = (window as unknown as { webkit?: { messageHandlers?: Record<string, Handler> } }).webkit?.messageHandlers?.visualizer;

export const isDesktop = !!handler;

let listener: (msg: never) => void = () => {};

export function post(msg: object): void {
  handler?.postMessage(JSON.stringify(msg));
}

export function onMessage<T>(fn: (msg: T) => void): void {
  listener = fn as (msg: never) => void;
}

(window as unknown as { __visualizer: unknown }).__visualizer = {
  receive(json: string) {
    listener(JSON.parse(json) as never);
  },
};
