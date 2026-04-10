const { createUnknownStub } = require('../../stubRuntime');

const moduleContract = {
  client_type: "EB.Sparx.GachaAPI",
  source_file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
  common_request_keys: [],
  endpoints: [
    {
      client_method: "PickFromBox",
      verb: "POST",
      path: "/gacha/pick",
      request_keys: [
        "group",
        "api",
        "version",
        "set",
        "box",
        "payment",
        "spins",
        "nonce"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.GachaAPI::PickFromBox"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<PickFromBox>c__AnonStorey79::<>m__40"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "ClaimFreeBox",
      verb: "POST",
      path: "/gacha/claimfree",
      request_keys: [
        "group",
        "api",
        "version",
        "set",
        "box",
        "nonce"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.GachaAPI::ClaimFreeBox"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<ClaimFreeBox>c__AnonStorey7A::<>m__41"
          }
        ],
        additional: []
      },
      notes: []
    }
  ]
};

moduleContract.handlers = Object.fromEntries(
  moduleContract.endpoints.map((endpoint) => [
    `${endpoint.verb} ${endpoint.path}`,
    createUnknownStub(moduleContract.client_type, endpoint)
  ])
);

module.exports = moduleContract;
