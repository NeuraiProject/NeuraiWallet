export type ReceiveDetailsStackParamList = {
  ReceiveDetails: {
    walletID?: string;
    address?: string;
    customLabel?: string;
    customAmount?: string;
    customUnit?: import('../models/xnaUnits').XnaUnit;
    bip21encoded?: string;
    isCustom?: boolean;
  };
  ReceiveCustomAmount: {
    address: string;
    currentLabel?: string;
    currentAmount?: string;
    currentUnit?: import('../models/xnaUnits').XnaUnit;
    preferredUnit?: import('../models/xnaUnits').XnaUnit;
  };
};
