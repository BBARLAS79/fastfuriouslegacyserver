const { createUnknownStub } = require('../../stubRuntime');

const moduleContract = {
  client_type: "EB.Sparx.AutoRefreshAPI",
  source_file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
  common_request_keys: [],
  endpoints: [
    {
      client_method: "Refresh",
      verb: "GET",
      path: "/autorefresh/",
      request_keys: [
        "api",
        "hash"
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
            function: "EB.Sparx.AutoRefreshAPI::Refresh"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<Refresh>c__AnonStorey6F::<>m__34"
          }
        ],
        additional: []
      },
      notes: []
    },
    {
      client_method: "GroupRefresh",
      verb: "GET",
      path: "/autorefresh/grouprefresh",
      request_keys: [
        "groups"
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
            function: "EB.Sparx.AutoRefreshAPI::GroupRefresh"
          }
        ],
        response: [
          {
            file: "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll",
            function: "<GroupRefresh>c__AnonStorey70::<>m__35"
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
