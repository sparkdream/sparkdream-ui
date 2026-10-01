// IBC core LCD responses (ibc-go), snake_case as the gateway returns them.

export interface IbcChannel {
  state: string; // "STATE_OPEN", "STATE_INIT", "STATE_TRYOPEN", "STATE_CLOSED"
  ordering: string;
  counterparty: { port_id: string; channel_id: string };
  connection_hops: string[];
  version: string;
  port_id: string;
  channel_id: string;
}

export interface IbcChannelsResponse {
  channels: IbcChannel[];
  pagination: { next_key: string | null; total: string };
}

export interface IbcChannelClientStateResponse {
  identified_client_state: {
    client_id: string;
    /** 07-tendermint carries the counterparty's chain_id; other client types may not. */
    client_state: { "@type": string; chain_id?: string };
  };
}

export interface IbcClientStatusResponse {
  status: string; // "Active", "Expired", "Frozen", "Unknown", "Unauthorized"
}
