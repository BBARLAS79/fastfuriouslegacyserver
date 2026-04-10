function createUnknownStub(moduleType, endpoint) {
  return function unknownFromClientContract() {
    return {
      statusCode: 501,
      payload: {
        error: 'UNKNOWN_FROM_CLIENT_CONTRACT',
        module: moduleType,
        path: endpoint.path,
        method: endpoint.verb,
        requestKeys: endpoint.request_keys,
        responseContract: endpoint.response_contract,
        sources: endpoint.sources
      }
    };
  };
}

module.exports = {
  createUnknownStub
};
