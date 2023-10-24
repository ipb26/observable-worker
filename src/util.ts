
import { customAlphabet } from "nanoid"
import pDefer from "p-defer"
import { EMPTY, Observable, Observer, Subscription, map, mergeMap, throwError } from "rxjs"
import { Connection } from "./channel"
import { Allowed, Target } from "./processing"

/**
 * Config for utility class for combining and observable and observer.
 */
export type ObservableAndObserverConfig<I, O> = {

    readonly observable: Observable<I>
    readonly observer: Observer<O>

}

/**
 * Utility class for combining and observable and observer.
 */
export class ObservableAndObserver<I, O> extends Observable<I> implements Connection<I, O> {

    constructor(private readonly config: ObservableAndObserverConfig<I, O>) {
        super(subscriber => {
            return config.observable.subscribe(subscriber)
        })
    }

    complete() {
        return this.config.observer.complete()
    }
    next(value: O) {
        console.log("TODO", value)
        return this.config.observer.next(value)
    }
    error(error: unknown) {
        return this.config.observer.error(error)
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
 * Utility type for anything that has a postMessage method.
 */
export type HasPostMessage<T = unknown> = {

    postMessage(value: T): void

}

/**
 * A hack function to acquire a web lock and hold onto it.
 */
export async function acquireWebLock(name: string, options?: LockOptions) {
    return new Promise<() => void>((resolve, reject) => {
        navigator.locks.request(name, options ?? {}, () => {
            const defer = pDefer<void>()
            resolve(defer.resolve)
            return defer.promise
        }).catch(e => {
            reject(e)
        })
    })
}

/**
 * A hack function to acquire a web lock as an observable. Releases when unsubscribed.
 */
export function observeWebLock(name: string, options?: Omit<LockOptions, "signal">) {
    return new Observable<void>(subscriber => {
        const controller = new AbortController()
        const lock = acquireWebLock(name, { ...options, signal: controller.signal })
        lock.then(() => subscriber.next()).catch(error => {
            /* if (error instanceof DOMException && error.code === error.ABORT_ERR) {
                 return
             }*/
            subscriber.error(error)
        })
        return () => {
            controller.abort()
            lock.then(release => release())
        }
    })
}

/**
 * Generate a unique string ID.
 */
export function generateId() {
    return customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 22)()
}

/**
 * A deferred observable that performs a cleanup action on unsubscribe.
 */
export function closing<T>(factory: () => T, close: (value: T) => void) {
    return new Observable<T>(subscriber => {
        const value = factory()
        subscriber.next(value)
        return () => {
            close(value)
        }
    })
}

/**
 * Types for remote errors.
 */
export type RemoteErrorCode = "timeout" | "worker-disappeared" | "invalid-message"

/**
 * A special error with a retryable property, used when a migrating worker dies.
 */
export class RemoteError extends Error {

    constructor(readonly code: RemoteErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
    }

}

export type RegistryAction<K, V> = {
    readonly action: "add"
    readonly key: K
    readonly observable: Observable<V>
} | {
    readonly action: "delete"
    readonly key: K
}

export interface RegistryOptions {

    allowIncorrectIds?: boolean | undefined

}

export function registryWith<K, V>(options: RegistryOptions = {}) {
    return (observable: Observable<RegistryAction<K, V>>) => {
        return registry(observable, options)
    }
}

/**
 * An observable that combines other observables, but also allows removing them.
 */
export function registry<K, V>(observable: Observable<RegistryAction<K, V>>, options: RegistryOptions = {}) {
    const observables = new Map<K, Subscription>()
    return observable.pipe(
        /*
        finalize(() => {
            observables.forEach(observable => observable.unsubscribe())
            observables.clear()
        }),
        */
        mergeMap(action => {
            if (action.action === "add") {
                return new Observable<readonly [K, V]>(subscriber => {
                    const subscription = action.observable.pipe(map(value => [action.key, value] as const)).subscribe(subscriber)
                    observables.set(action.key, subscription)
                    return () => {
                        subscription.unsubscribe()
                        observables.delete(action.key)
                    }
                })
            }
            else {
                const observable = observables.get(action.key)
                if (!options.allowIncorrectIds) {
                    if (observable === undefined) {
                        return throwError(() => new Error("Tried to remove a non existent observable from a registry."))
                    }
                }
                observable?.unsubscribe()
                return EMPTY
            }
        }),
    )
}

export function callOnTarget<T extends Target>(target: T, command: string | number | symbol, data: readonly unknown[]) {
    if (!(command in target)) {
        throw new Error("Command " + command.toString() + " does not exist.")
    }
    const property = target[command as keyof T]
    const returned = (() => {
        if (typeof property === "function") {
            return property.call(target, ...data) as Allowed
        }
        else {
            return property as Allowed
        }
    })()
    if (typeof returned === "object" && returned !== null && "subscribe" in returned && returned.subscribe !== undefined) {
        return {
            observable: returned,
        }
    }
    else {
        return {
            promise: async () => await returned
        }
    }
}

export function proxy<I extends object, O extends object>(target: I, handler: ProxyHandler<I>) {
    return new Proxy(target, handler) as unknown as O
}
