// Public surface of the page fetcher. See ADR-11C.2.

export { fetchPageBytes } from "./fetchPageBytes.js";
export {
  FetcherError,
  FETCHER_ERROR_CODES,
  type FetcherErrorCode,
  type FetcherDeps,
  type FetchedPage,
  type HttpsTransport,
  type HttpsTransportResponse,
  type DnsAddress,
  type DnsLookupFn,
} from "./types.js";
export {
  makeNodeHttpsRequestTransport,
  makeNodeFetchHttpsTransport,
  makePinnedLookup,
  type MakeNodeHttpsRequestTransportOptions,
} from "./httpsTransport.js";
