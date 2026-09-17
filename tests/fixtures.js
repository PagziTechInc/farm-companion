export const RPC_ABORT = Symbol('rpc-abort');

export function rpcResult(request, result) {
  return { jsonrpc: '2.0', id: request.id, result };
}

export function rpcError(request, error, code = -32603) {
  return {
    jsonrpc: '2.0',
    id: request.id,
    error: { code, message: error instanceof Error ? error.message : String(error) },
  };
}

export async function fulfillRpcBatch(route, handler) {
  const body = route.request().postDataJSON();
  const requests = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const request of requests) {
    const response = await handler(request);
    if (response === RPC_ABORT) {
      await route.abort();
      return;
    }
    responses.push(response);
  }
  await route.fulfill({ json: Array.isArray(body) ? responses : responses[0] });
}
