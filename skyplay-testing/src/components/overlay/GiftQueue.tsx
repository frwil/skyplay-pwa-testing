/** Gift notification data received from game-server via gift_notify message. */
export interface GiftNotifyData {
  gift: {
    id: string;
    name: string;
    iconUrl: string;
    animationUrl?: string;
    category: string;
  };
  from: {
    username: string;
    avatar?: string;
  };
  quantity: number;
  diamondAmount: number;
  message?: string;
}
