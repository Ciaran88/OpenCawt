import type { TickerEvent } from "../data/types";

export interface VoteSimulationTarget {
  caseId: string;
  currentVotes: number;
  maxVotes: number;
}

export interface SimulationHandlers {
  onNowTick: (nowMs: number) => void;
  onVoteIncrement: (caseId: string, nextVotes: number) => void;
  onTickerPush: (event: TickerEvent) => void;
}

export interface SimulationController {
  start: () => void;
  stop: () => void;
  setVoteTarget: (target: VoteSimulationTarget | null) => void;
  setTickerSeed: (seed: TickerEvent[]) => void;
}

export function createSimulation(
  handlers: SimulationHandlers,
  initialTickerSeed: TickerEvent[]
): SimulationController {
  let clockTimer: number | null = null;
  let voteTimer: number | null = null;
  let tickerTimer: number | null = null;
  let voteTarget: VoteSimulationTarget | null = null;
  let tickerSeed = [...initialTickerSeed];

  const startClock = () => {
    if (clockTimer !== null) {
      return;
    }
    clockTimer = window.setInterval(() => {
      handlers.onNowTick(Date.now());
    }, 1000);
  };

  const stopClock = () => {
    if (clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };

  const restartVoteTimer = () => {
    if (voteTimer !== null) {
      window.clearInterval(voteTimer);
      voteTimer = null;
    }

    if (!voteTarget) {
      return;
    }

    voteTimer = window.setInterval(() => {
      if (!voteTarget) {
        return;
      }
      if (voteTarget.currentVotes >= voteTarget.maxVotes) {
        return;
      }
      voteTarget.currentVotes += 1;
      handlers.onVoteIncrement(voteTarget.caseId, voteTarget.currentVotes);
    }, 3200);
  };

  const startTicker = () => {
    if (tickerTimer !== null || tickerSeed.length === 0) {
      return;
    }
    let index = 0;
    tickerTimer = window.setInterval(() => {
      if (tickerSeed.length === 0) {
        return;
      }
      handlers.onTickerPush(tickerSeed[index % tickerSeed.length]);
      index += 1;
    }, 12000);
  };

  const stopTicker = () => {
    if (tickerTimer !== null) {
      window.clearInterval(tickerTimer);
      tickerTimer = null;
    }
  };

  return {
    start() {
      startClock();
      startTicker();
      restartVoteTimer();
    },
    stop() {
      stopClock();
      stopTicker();
      if (voteTimer !== null) {
        window.clearInterval(voteTimer);
        voteTimer = null;
      }
      voteTarget = null;
    },
    setVoteTarget(target) {
      voteTarget = target ? { ...target } : null;
      restartVoteTimer();
    },
    setTickerSeed(seed) {
      tickerSeed = [...seed];
      stopTicker();
      startTicker();
    }
  };
}
