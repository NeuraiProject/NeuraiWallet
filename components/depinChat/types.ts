export interface DePINChatProps {
  walletID: string;
}

export interface DePINChatHandle {
  /** Handle a back action: true = consumed (closed the open token chat), false = nothing to close. */
  goBack: () => boolean;
}

/** Server DePIN configuration reported by `depingetmsginfo`. */
export interface DepinServerInfo {
  enabled?: boolean;
  token?: string;
  cipher?: string;
  maxrecipients?: number;
  maxmessagesize?: number;
  messageexpiryhours?: number;
  maxpoolsizemb?: number;
}
