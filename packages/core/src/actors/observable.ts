import { XSTATE_STOP } from '../constants';
import {
  Subscribable,
  ActorLogic,
  EventObject,
  Subscription,
  AnyActorSystem,
  ActorRefFrom,
  Snapshot
} from '../types';

export type ObservableSnapshot<TContext, TInput> = Snapshot<undefined> & {
  context: TContext | undefined;
  input: TInput | undefined;
  _subscription: Subscription | undefined;
};

export type ObservableActorLogic<TContext, TInput> = ActorLogic<
  ObservableSnapshot<TContext, TInput>,
  { type: string; [k: string]: unknown },
  TInput,
  AnyActorSystem
>;

export type ObservableActorRef<TContext> = ActorRefFrom<
  ObservableActorLogic<TContext, any>
>;

export function fromObservable<TContext, TInput>(
  observableCreator: ({
    input,
    system
  }: {
    input: TInput;
    system: AnyActorSystem;
    self: ObservableActorRef<TContext>;
  }) => Subscribable<TContext>
): ObservableActorLogic<TContext, TInput> {
  const nextEventType = '$$xstate.next';
  const errorEventType = '$$xstate.error';
  const completeEventType = '$$xstate.complete';

  // TODO: add event types
  const logic: ObservableActorLogic<TContext, TInput> = {
    config: observableCreator,
    transition: (snapshot, event, { self, id, defer, system }) => {
      if (snapshot.status !== 'active') {
        return snapshot;
      }

      switch (event.type) {
        case nextEventType: {
          const newSnapshot = {
            ...snapshot,
            context: event.data as TContext
          };
          return newSnapshot;
        }
        case errorEventType:
          return {
            ...snapshot,
            status: 'error',
            error: (event as any).data,
            input: undefined,
            _subscription: undefined
          };
        case completeEventType:
          return {
            ...snapshot,
            status: 'done',
            input: undefined,
            _subscription: undefined
          };
        case XSTATE_STOP:
          snapshot._subscription!.unsubscribe();
          return {
            ...snapshot,
            status: 'stopped',
            input: undefined,
            _subscription: undefined
          };
        default:
          return snapshot;
      }
    },
    getInitialState: (_, input) => {
      return {
        status: 'active',
        output: undefined,
        error: undefined,
        context: undefined,
        input,
        _subscription: undefined
      };
    },
    start: (state, { self, system }) => {
      if (state.status === 'done') {
        // Do not restart a completed observable
        return;
      }
      state._subscription = observableCreator({
        input: state.input!,
        system,
        self
      }).subscribe({
        next: (value) => {
          system._relay(self, self, { type: nextEventType, data: value });
        },
        error: (err) => {
          system._relay(self, self, { type: errorEventType, data: err });
        },
        complete: () => {
          system._relay(self, self, { type: completeEventType });
        }
      });
    },
    getPersistedState: ({ _subscription, ...state }) => state,
    restoreState: (state) => ({
      ...(state as any),
      _subscription: undefined
    })
  };

  return logic;
}

/**
 * Creates event observable logic that listens to an observable
 * that delivers event objects.
 *
 *
 * @param lazyObservable A function that creates an observable
 * @returns Event observable logic
 */

export function fromEventObservable<T extends EventObject, TInput>(
  lazyObservable: ({
    input,
    system
  }: {
    input: TInput;
    system: AnyActorSystem;
    self: ObservableActorRef<T>;
  }) => Subscribable<T>
): ObservableActorLogic<T, TInput> {
  const errorEventType = '$$xstate.error';
  const completeEventType = '$$xstate.complete';

  // TODO: event types
  const logic: ObservableActorLogic<T, TInput> = {
    config: lazyObservable,
    transition: (state, event) => {
      if (state.status !== 'active') {
        return state;
      }

      switch (event.type) {
        case errorEventType:
          return {
            ...state,
            status: 'error',
            error: (event as any).data,
            input: undefined,
            _subscription: undefined
          };
        case completeEventType:
          return {
            ...state,
            status: 'done',
            input: undefined,
            _subscription: undefined
          };
        case XSTATE_STOP:
          state._subscription!.unsubscribe();
          return {
            ...state,
            status: 'stopped',
            input: undefined,
            _subscription: undefined
          };
        default:
          return state;
      }
    },
    getInitialState: (_, input) => {
      return {
        status: 'active',
        output: undefined,
        error: undefined,
        context: undefined,
        input,
        _subscription: undefined
      };
    },
    start: (state, { self, system }) => {
      if (state.status === 'done') {
        // Do not restart a completed observable
        return;
      }

      state._subscription = lazyObservable({
        input: state.input!,
        system,
        self
      }).subscribe({
        next: (value) => {
          if (self._parent) {
            system._relay(self, self._parent, value);
          }
        },
        error: (err) => {
          system._relay(self, self, { type: errorEventType, data: err });
        },
        complete: () => {
          system._relay(self, self, { type: completeEventType });
        }
      });
    },
    getPersistedState: ({ _subscription, ...state }) => state,
    restoreState: (state: any) => ({
      ...state,
      _subscription: undefined
    })
  };

  return logic;
}
