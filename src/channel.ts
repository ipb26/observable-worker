
import { BehaviorSubject, Observable, filter, fromEvent, mergeMap, switchMap, takeUntil, tap, throwError } from "rxjs";
import { HasEventTargetAddRemove } from "rxjs/internal/observable/fromEvent";
import { Batcher, BatcherOptions } from "./batcher";

/**
 * A connection is used to send and receive messages.
 */
export interface Connection<I, O> {

    /**
     * An observable for listening to this connection.
     */
    readonly observe: Observable<I>

    /**
     * Send a message over this connection.
     * @param message The message.
     */
    send(message: O): void

    /**
     * Close this connection.
     */
    close(): void

}

/**
 * A channel creates Connection objects.
 */
export type Channel<I, O> = () => Connection<I, O>

export namespace Channel {

    /**
     * A pre-created channel from this window's globalThis.
     */
    export const SELF = port(globalThis)

    /**
     * Wraps another channel and batches any messages sent to it. Also treats incoming messages as batches.
     */
    export function batching<I, O>(channel: Channel<readonly I[], readonly O[]>, options?: BatcherOptions<O> | undefined): Channel<I, O> {
        return () => {
            const connection = channel()
            const batcher = new Batcher<O>(connection.send.bind(connection), options)
            return {
                observe: connection.observe.pipe(mergeMap(items => Array.isArray(items) ? items : throwError(() => new TypeError("Batching channel received a non-array message.")))),
                send: batcher.add.bind(batcher),
                close: () => {
                    batcher.process()
                    connection.close()
                }
            }
        }
    }

    export function logging<I, O>(channel: Channel<I, O>, name: string = "Untitled"): Channel<I, O> {
        return () => {
            const connection = channel()
            return {
                observe: connection.observe.pipe(tap(emission => console.log("Received emission on channel " + name + ".", emission))),
                send: value => {
                    console.log("Sending emission on channel " + name + ".", value)
                    connection.send(value)
                },
                close: connection.close,
            }
        }
    }

    export function worker(scriptUrl: string | URL, options?: WorkerOptions | undefined) {
        return port(() => new Worker(scriptUrl, options), worker => worker.terminate())
    }

    /**
     * A broadcast channel.
     * @param name The name of the channel.
     * @returns A channel.
     */
    export function broadcast<I, O>(name: string): Channel<I, O> {
        return port(() => new BroadcastChannel(name), channel => channel.close())
    }

    /**
     * A two way port.
     */
    export type Port<I, O> = HasEventTargetAddRemove<MessageEvent<I>> & { postMessage(value: O): void }

    export function port<T extends Port<I, O>, I = never, O = unknown>(open: T | (() => T), close?: ((port: T) => void) | undefined): Channel<I, O> {
        return () => {
            const connection = typeof open === "function" ? open() : open
            const closed = new BehaviorSubject(false)
            return {
                observe: fromEvent(connection, "message", event => event.data).pipe(takeUntil(closed.pipe(filter(closed => closed), switchMap(() => throwError(() => new Error("This channel is closed.")))))),
                send: value => {
                    if (closed.getValue()) {
                        throw new Error("This channel is closed.")
                    }
                    connection.postMessage(value)
                },
                close: () => {
                    if (closed.getValue()) {
                        throw new Error("This channel is closed.")
                    }
                    closed.next(true)
                    closed.complete()
                    if (close !== undefined) {
                        close(connection)
                    }
                }
            }
        }
    }

}
