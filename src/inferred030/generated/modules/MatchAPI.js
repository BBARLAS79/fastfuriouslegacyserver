const { createUnknownStub } = require('../../stubRuntime');

const moduleContract = {
  client_type: "EB.Sparx.MatchAPI",
  source_file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
  common_request_keys: [
    "api"
  ],
  endpoints: [
    {
      client_method: "ActivateMatch",
      verb: "POST",
      path: "/matches/activate-match",
      request_keys: [
        "api",
        "type",
        "UNKNOWN(dynamic extra payload from caller)"
      ],
      response_contract: {
        success_envelope: "success -> response.hashtable",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {
          hashtable: "UNKNOWN"
        }
      },
      status: "PARTIAL",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.MatchAPI::ActivateMatch"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<ActivateMatch>c__AnonStorey99`1::<>m__64"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "ResolveMatch",
      verb: "POST",
      path: "/matches/resolve-match",
      request_keys: [
        "api",
        "type",
        "id"
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
            function: "EB.Sparx.MatchAPI::ResolveMatch"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<ResolveMatch>c__AnonStorey9A`2::<>m__65"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "SimulateMatch",
      verb: "POST",
      path: "/matches/simulate-match",
      request_keys: [
        "api",
        "type"
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
            function: "EB.Sparx.MatchAPI::SimulateMatch"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<SimulateMatch>c__AnonStorey9B`1::<>m__66"
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
