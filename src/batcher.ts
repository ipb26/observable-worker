import { debounce } from "throttle-debounce";

const DEFAULT_DEBOUNCE_TIME = 1

export interface BatcherOptions<T> {

    readonly debounceTime?: number | undefined
    readonly maxItems?: number | undefined
    readonly flushTest?: ((items: readonly T[]) => boolean) | undefined

}

export class Batcher<T> {

    private readonly debounced
    private readonly items = new Array<T>()

    constructor(private readonly flush: (items: T[]) => void, private readonly options?: BatcherOptions<T>) {
        const debounceTime = options?.debounceTime ?? DEFAULT_DEBOUNCE_TIME
        if (debounceTime > 0) {
            this.debounced = debounce(debounceTime, this.process.bind(this))
        }
        else {
            this.debounced = this.process.bind(this)
        }
    }

    process() {
        const items = this.items.splice(0)
        if (items.length > 0) {
            this.flush(items)
        }
    }

    add(item: T) {
        this.items.push(item)
        if (this.options?.maxItems !== undefined && this.items.length >= this.options.maxItems) {
            return this.process()
        }
        if (this.options?.flushTest?.(this.items) ?? false) {
            return this.process()
        }
        return this.debounced()
    }

}
