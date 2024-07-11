import { customAlphabet } from "nanoid"
import PLazy from "p-lazy"
import { Observable, Subject, concatWith, dematerialize, filter, firstValueFrom, from, share, takeUntil, throwError } from "rxjs"
import { Channel } from "./channel"
import { Proxied, Request, Response, Target } from "./types"

export const WORKER_CLOSE = Symbol()

export interface Remote<T extends Target> {

    /**
     * The proxied object.
     */
    readonly proxy: Proxied<T>

    /**
     * Close this remote.
     */
    close(): void

}

export interface WrapOptions {

    /**
     * The channel to wrap.
     */
    readonly channel: Channel<Response, Request>

}

export function wrap<T extends Target>(options: WrapOptions): Remote<T> {
    const closed = new Subject<void>()
    const connection = options.channel()
    const proxy = new Proxy({}, {
        get(_target, command) {
            if (typeof command === "symbol") {
                throw new Error("No symbol calls on a proxy.")
            }
            return (...data: readonly unknown[]) => {
                const observable = new Observable<unknown>(subscriber => {
                    const id = generateId()
                    const observable = from(connection.observe).pipe(
                        filter(response => response.id === id),
                        dematerialize(),
                        takeUntil(closed.pipe(concatWith(throwError(() => new Error("This remote is closed."))))),
                    )
                    const subscription = observable.subscribe(subscriber)
                    connection.send({
                        kind: "S",
                        id,
                        command,
                        data,
                    })
                    return () => {
                        subscription.unsubscribe()
                        connection.send({
                            kind: "U",
                            id
                        })
                    }
                })
                const shared = observable.pipe(share())
                return new ObservableAndPromise(shared, PLazy.from(() => firstValueFrom(shared)))
            }
        }
    }) as Proxied<T>
    const close = () => {
        closed.complete()
        connection.close()
    }
    return {
        proxy,
        close
    }
}

/**
 * Utility class for combining and observable and promise.
 */
export class ObservableAndPromise<T> extends Observable<T> implements PromiseLike<T> {

    constructor(private readonly observable: Observable<T>, private readonly promise: PromiseLike<T>) {
        super(subscriber => this.observable.subscribe(subscriber))
    }

    then<TResult1 = T, TResult2 = never>(onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined, onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined) {
        return this.promise.then(onFulfilled, onRejected)
    }

}

/**
 * Generate a unique string ID.
 */
export function generateId() {
    return customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 22)()
}
