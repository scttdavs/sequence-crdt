import VersionVector from "./versionVector";
import Char from "./char";
import Identifier from "./identifier";
import Version from "./version";

export function randomID() {
  return Math.random()
    .toString(36)
    .substr(2, 9);
}

export enum Strategy {
  Plus = "Plus",
  Minus = "Minus",
  Random = "Random",
  Every2nd = "Every2nd",
  Every3rd = "Every3rd"
}

export interface CRDTOptions {
  siteID: string;
  struct?: Char[];
  base?: number;
  boundary?: number;
  strategy?: Strategy;
  mult?: number;
}

export class CRDT {
  public vector: VersionVector;
  public struct: Char[];
  public siteID: string;
  public text: string;
  private base: number;
  private boundary: number;
  private strategy: Strategy;
  private strategyCache: Strategy[];
  private mult: number;
  private delBuffer: Char[];
  constructor({
    siteID = randomID(),
    struct = [],
    base = 32,
    boundary = 10,
    strategy = Strategy.Random,
    mult = 2
  }: CRDTOptions) {
    this.siteID = siteID;
    this.vector = new VersionVector(this.siteID);
    this.struct = struct;
    this.text = "";
    this.base = base;
    this.boundary = boundary;
    this.strategy = strategy;
    this.strategyCache = [];
    this.mult = mult;
    this.delBuffer = [];
  }

  public handleLocalInsert(index: number, val: string): Char {
    this.vector.increment();

    const char = this.generateChar(val, index);
    this.insertChar(index, char);
    this.insertText(index, char.value);
    return char;
  }

  public handleRemoteInsert(char: Char) {
    if (this.vector.hasBeenApplied(new Version(char.siteID, char.counter))) {
      return;
    }

    const index = this.findInsertionIndex(char);

    this.insertChar(index, char);
    this.insertText(index, char.value);

    // Update version
    this.vector.update(new Version(char.siteID, char.counter));

    // Process deletion buffer
    this.processDeletionBuffer();
  }

  public handleLocalDelete(index: number): Char {
    this.vector.increment();

    const char = this.struct.splice(index, 1)[0];
    this.deleteText(index);
    return char;
  }

  public handleRemoteDelete(char: Char) {
    // if (this.vector.hasBeenApplied(new Version(char.siteID, char.counter))) {
    //   return;
    // }

    const index = this.findDeletionIndex(char);
    if (index < 0) {
      this.delBuffer.push(char);
      return;
    }

    this.struct.splice(index, 1);
    this.deleteText(index);

    // Update version
    this.vector.update(new Version(char.siteID, char.counter));
  }

  private processDeletionBuffer() {
    let i = 0;
    while (i < this.delBuffer.length) {
      const deleteChar = this.delBuffer[i];
      if (
        this.vector.hasBeenApplied(
          new Version(deleteChar.siteID, deleteChar.counter)
        )
      ) {
        this.handleRemoteDelete(deleteChar);
        this.delBuffer.splice(i, 1);
      } else {
        i++;
      }
    }
  }

  private insertChar(index: number, char: Char) {
    this.struct.splice(index, 0, char);
  }

  private insertText(index: number, val: string) {
    this.text = this.text.slice(0, index) + val + this.text.slice(index);
  }

  private deleteText(index: number) {
    this.text = this.text.slice(0, index) + this.text.slice(index + 1);
  }

  public populateText() {
    this.text = this.struct.map(char => char.value).join("");
    return this.text;
  }

  private generateChar(val: string, index: number): Char {
    const posBefore =
      (this.struct[index - 1] && this.struct[index - 1].position) || [];
    const posAfter = (this.struct[index] && this.struct[index].position) || [];
    const newPos = this.generatePosBetween(posBefore, posAfter);
    const localCounter = this.vector.localVersion.counter;
    return new Char(val, localCounter, this.siteID, newPos);
  }

  private generatePosBetween(
    pos1: Identifier[],
    pos2: Identifier[],
    newPos: Identifier[] = [],
    level = 0
  ): Identifier[] {
    let base = Math.pow(this.mult, level) * this.base;
    let boundaryStrategy = this.retrieveStrategy(level);
    let id1 = pos1[0] || new Identifier(0, this.siteID);
    let id2 = pos2[0] || new Identifier(base, this.siteID);
    if (id2.digit - id1.digit > 1) {
      const newDigit = this.generateIdBetween(
        id1.digit,
        id2.digit,
        boundaryStrategy
      );
      newPos.push(new Identifier(newDigit, this.siteID));
      return newPos;
    } else if (id2.digit - id1.digit === 1) {
      newPos.push(id1);
      return this.generatePosBetween(pos1.slice(1), [], newPos, level + 1);
    } else if (id1.digit === id2.digit) {
      if (id1.siteID < id2.siteID) {
        newPos.push(id1);
        return this.generatePosBetween(pos1.slice(1), [], newPos, level + 1);
      } else if (id1.siteID === id2.siteID) {
        newPos.push(id1);
        return this.generatePosBetween(
          pos1.slice(1),
          pos2.slice(1),
          newPos,
          level + 1
        );
      } else {
        throw new Error("Fix Position Sorting");
      }
    }
  }

  private retrieveStrategy(level: number): Strategy {
    if (level < this.strategyCache.length) {
      return this.strategyCache[level];
    }

    let strategy;
    switch (this.strategy) {
      case Strategy.Plus:
        strategy = Strategy.Plus;
        break;
      case Strategy.Minus:
        strategy = Strategy.Minus;
        break;
      case Strategy.Random:
        strategy =
          Math.round(Math.random()) === 0 ? Strategy.Plus : Strategy.Minus;
        break;
      case Strategy.Every2nd:
        strategy = (level + 1) % 2 === 0 ? Strategy.Minus : Strategy.Plus;
        break;
      case Strategy.Every3rd:
        strategy = (level + 1) % 3 === 0 ? Strategy.Minus : Strategy.Plus;
        break;
      default:
        strategy = (level + 1) % 2 === 0 ? Strategy.Minus : Strategy.Plus;
        break;
    }

    this.strategyCache[level] = strategy;
    return strategy;
  }

  private generateIdBetween(
    min: number,
    max: number,
    boundaryStrategy: Strategy
  ): number {
    if (max - min < this.boundary) {
      min = min + 1;
    } else {
      if (boundaryStrategy === Strategy.Minus) {
        min = max - this.boundary;
      } else {
        // Plus
        min = min + 1;
        max = min + this.boundary;
      }
    }
    return Math.floor(Math.random() * (max - min)) + min;
  }

  private findInsertionIndex(char: Char) {
    let left = 0;
    let right = this.struct.length - 1;
    let mid: number, compareNum: number;
    if (this.struct.length === 0 || char.compareTo(this.struct[left]) < 0) {
      return left;
    } else if (char.compareTo(this.struct[right]) > 0) {
      return this.struct.length;
    }

    while (left + 1 < right) {
      mid = Math.floor(left + (right - left) / 2);
      compareNum = char.compareTo(this.struct[mid]);
      if (compareNum === 0) {
        return mid;
      } else if (compareNum > 0) {
        left = mid;
      } else {
        right = mid;
      }
    }
    return char.compareTo(this.struct[left]) === 0 ? left : right;
  }

  private findDeletionIndex(char: Char) {
    let left = 0;
    let right = this.struct.length - 1;
    let mid, compareNum;

    if (this.struct.length === 0) {
      return -1;
      // throw new Error("Character does not exist in CRDT.");
    }

    while (left + 1 < right) {
      mid = Math.floor(left + (right - left) / 2);
      compareNum = char.compareTo(this.struct[mid]);

      if (compareNum === 0) {
        return mid;
      } else if (compareNum > 0) {
        left = mid;
      } else {
        right = mid;
      }
    }

    if (char.compareTo(this.struct[left]) === 0) {
      return left;
    } else if (char.compareTo(this.struct[right]) === 0) {
      return right;
    } else {
      return -1;
      // throw new Error("Character does not exist in CRDT.");
    }
  }
}
