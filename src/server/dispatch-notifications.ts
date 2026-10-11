export interface DispatchNotificationProvider {
  dispatchPublished(input: {
    dispatchRunId: string;
    deliveryDate: string;
    partnerIds: string[];
  }): Promise<void>;
}
