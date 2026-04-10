const { createUnknownStub } = require('../../stubRuntime');

const moduleContract = {
  client_type: "EB.Sparx.DataAPI",
  source_file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
  common_request_keys: [],
  endpoints: [
    {
      client_method: "Load",
      verb: "GET",
      path: "/ds/{0}/{1}",
      request_keys: [],
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
            function: "EB.Sparx.DataAPI::Load"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Load>c__AnonStorey74::<>m__3A"
          }
        ],
        additional: []
      },
      notes: [
        "Client expects a hashtable on success. Inner save schema is UNKNOWN at the API layer and must be inferred from higher-level managers."
      ]
    },
    {
      client_method: "Save",
      verb: "POST",
      path: "/ds/{0}",
      request_keys: [
        "data"
      ],
      response_contract: {
        success_envelope: "success -> no explicit payload",
        failure_envelope: "failure -> response.localizedError",
        known_fields: {}
      },
      status: "UNKNOWN",
      sources: {
        request: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "EB.Sparx.DataAPI::Save"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Save>c__AnonStorey75::<>m__3B"
          }
        ],
        additional: []
      },
      notes: [
        "On success the callback only receives null error. No success payload is explicitly read."
      ]
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
