export function createLeaseOwnershipRenewal(
  renew: () => Promise<boolean>,
  lostMessage: string,
): () => Promise<void> {
  let ownershipLoss: Error | null = null;
  let pending: Promise<void> | null = null;

  return () => {
    if (pending !== null) {
      return pending;
    }
    if (ownershipLoss !== null) {
      return Promise.reject(ownershipLoss);
    }

    pending = renew()
      .then(
        (renewed) => {
          if (!renewed) {
            ownershipLoss = new Error(lostMessage);
            throw ownershipLoss;
          }
        },
        (cause) => {
          ownershipLoss = new Error(lostMessage, { cause });
          throw ownershipLoss;
        },
      )
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
