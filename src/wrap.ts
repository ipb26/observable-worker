import { customAlphabet } from "nanoid"
import PLazy from "p-lazy"
import { Observable, Subject, concatWith, dematerialize, filter, firstValueFrom, from, takeUntil, throwError } from "rxjs"
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

    /**
     * An ID generator.
     */
    readonly generateId?: (() => string | number) | undefined

}

export function wrap<T extends Target>(options: WrapOptions): Remote<T> {
    const closed = new Subject<void>()
    const connection = options.channel()
    const generateId = options.generateId ?? stringIdGenerator()
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
                return new ObservableAndPromise(observable, PLazy.from(() => firstValueFrom(observable)))
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
export function stringIdGenerator() {
    return customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 22)
}
export function incrementingIdGenerator() {
    var id = 0
    return () => {
        return id++
    }
}
