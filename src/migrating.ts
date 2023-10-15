
import { Observable, Subscription } from "rxjs"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { Coordinator } from "./coordinator"
import { DirectReceiver } from "./direct"
import { ChannelWrapper } from "./newremote"
import { Target, proxy } from "./processing"
import { Wrap } from "./wrap"

interface ExposeMigratingConfig<T extends Target> {

    readonly coordinator: Coordinator
    readonly log?: boolean
    readonly target: ValueOrFactory<Observable<T>, [unknown]>

}

export function exposeMigrating<T extends Target>(config: ExposeMigratingConfig<T>) {
    const clients = new Map<string, Subscription>()
    return config.coordinator.backEnd.subscribe(action => {
        if (action.action === "added") {
            //TODO make some kind of observable that keeps a registry maybe, to abstract this
            const target = callOrGet(config.target, action.id)
            const receiver = new DirectReceiver({
                channel: action.channel,
                target: target,
                log: config.log,
            })
            clients.set(action.id, receiver.subscribe())
        }
        else {
            clients.get(action.id)?.unsubscribe()
            clients.delete(action.id)
        }
    })
}

export interface WrapMigratingConfig {

    readonly coordinator: Coordinator
    readonly log?: boolean
    readonly autoRetryPromises?: boolean | undefined
    readonly autoRetryObservables?: boolean | undefined

}

export function wrapMigrating<T extends Target>(config: WrapMigratingConfig): Wrap<T> {
    const sender = new ChannelWrapper({ log: config.log, autoRetryObservables: config.autoRetryObservables, autoRetryPromises: config.autoRetryPromises, channel: config.coordinator.frontEnd })
    return {
        remote: proxy<T>(sender),
        close: () => sender.close()
    }
}
