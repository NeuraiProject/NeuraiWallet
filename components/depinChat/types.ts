export interface DePINChatProps {
  walletID: string;
  /**
   * The chat stays mounted behind another wallet tab to keep its state. While
   * hidden it must not poll: each poll marks the pool as read (clearing the
   * tab's new-message dot unseen) and, on a hardware wallet, costs a device op.
   */
  paused?: boolean;
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
