import { metaSymbol } from "./response-container";
import type { MetaInfo } from "./types";

export const isMetaInfoList = (value: unknown): value is MetaInfo[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "errorSubscriptions" in item &&
      "refCount" in item,
  );

/** Adds a watcher to a node's meta list and returns its removal. */
export type WatchErrors = (node: {
  readonly [metaSymbol]?: unknown;
}) => () => void;

/**
 * Errors read through a stream that shows other nodes (a projection) must not
 * be reported as unhandled by those nodes while the stream has error
 * subscribers. `own` is the stream's meta; `watch` adds a watcher that reads
 * its count to a shown node's meta list (and ignores the node's own
 * bookkeeping, so subscribers of the node cannot unbalance it) and returns the
 * removal.
 */
export const errorWatcher = (): {
  readonly own: MetaInfo;
  readonly watch: WatchErrors;
} => {
  const own: MetaInfo = { errorSubscriptions: 0, refCount: true };
  const watcher: MetaInfo = {
    get errorSubscriptions() {
      return own.errorSubscriptions;
    },
    set errorSubscriptions(_: number) {},
    refCount: true,
  };
  const watch: WatchErrors = (node) => {
    const nodeMeta = node[metaSymbol];
    const list = isMetaInfoList(nodeMeta) ? nodeMeta : undefined;
    list?.push(watcher);
    return () => {
      const at = list?.indexOf(watcher) ?? -1;
      if (at >= 0) list?.splice(at, 1);
    };
  };
  return { own, watch };
};
