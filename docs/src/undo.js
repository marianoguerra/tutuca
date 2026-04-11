function evictLeftClosestPair(items, len) {
  let closestChangesIndex = 0,
    leftTimestamp = items[0].timestamp,
    closestDiff = Infinity;

  // remove the left item from the pair that has the closest timestamp
  // diff. The idea is to keep a good spread sample of the history when
  // evicting
  for (let i = 1; i < len; i += 1) {
    const curTimestamp = items[i].timestamp,
      curDiff = curTimestamp - leftTimestamp;

    // <= to make it remove the most recent left item with min diff,
    // to keep older ones that may be more useful
    if (curDiff <= closestDiff) {
      closestDiff = curDiff;
      closestChangesIndex = i - 1;
    }

    leftTimestamp = curTimestamp;
  }

  items.splice(closestChangesIndex, 1);
}

export class ValueHistory {
  constructor(maxItems) {
    this.maxItems = maxItems ?? 25;
    this.items = [];
  }

  onChange(changeEvent) {
    const items = this.items,
      len = items.length;
    if (len >= this.maxItems) {
      evictLeftClosestPair(items, len);
    }

    items.push(changeEvent);
  }

  get size() {
    return this.items.length;
  }

  at(i) {
    return this.items.at(i);
  }

  mountSlider(rootNode, cb) {
    const input = document.createElement("input");
    input.type = "range";
    input.addEventListener("input", (e) => {
      const index = +e.target.value;
      const entry = this.at(index);
      cb({ index, entry });
    });
    rootNode.appendChild(input);
    return input;
  }
}
