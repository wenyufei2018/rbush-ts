// eslint-disable-next-line @typescript-eslint/no-var-requires
const quickselect = require('quickselect');

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error('Assertion Error: ' + message);
  }
}

// TODO: 生产环境去掉该计算
function isBBox(item: unknown): item is BBox {
  const keys = ['minX', 'minY', 'maxX', 'maxY'];
  for (const key of keys) {
    if (typeof item[key] !== 'number') {
      return false;
    }
  }
  return true;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Leaf<T> extends BBox {
  children: Array<T>;
  leaf: true;
  height: 1;
}

interface Branch<T> extends BBox {
  children: Array<Node<T>>;
  leaf: false;
  height: number;
}

type Node<T> = Branch<T> | Leaf<T>;

export type ToBBox<T> = (node: T) => BBox;
export type EqualsFn<T> = (a: Readonly<T>, b: Readonly<T>) => boolean;
export type compareMin<T> = (a: Readonly<T>, b: Readonly<T>) => number;

export default class RBush<T> {
  private _maxEntries: number;
  private _minEntries: number;
  private data: Node<T>;

  constructor(maxEntries = 9) {
    // max entries in a node is 9 by default; min node fill is 40% for best performance
    this._maxEntries = Math.max(4, maxEntries);
    this._minEntries = Math.max(2, Math.ceil(this._maxEntries * 0.4));
    this.clear();
  }

  toBBox(item: T): BBox {
    assert(isBBox(item), '如果 item 不是 BBox 类型，需要重写 toBBox');
    return item;
  }

  compareMinX(a: Readonly<T>, b: Readonly<T>): number {
    assert(isBBox(a), '如果 a 不是 BBox 类型，需要重写 compareMinX');
    assert(isBBox(b), '如果 b 不是 BBox 类型，需要重写 compareMinX');
    return compareNodeMinX(a, b);
  }

  compareMinY(a: Readonly<T>, b: Readonly<T>): number {
    assert(isBBox(a), '如果 a 不是 BBox 类型，需要重写 compareMinY');
    assert(isBBox(b), '如果 b 不是 BBox 类型，需要重写 compareMinY');
    return compareNodeMinY(a, b);
  }

  all(): T[] {
    return this._all(this.data, []);
  }

  search(bbox: BBox): T[] {
    let node: Node<T> = this.data;
    const result: T[] = [];

    if (!intersects(bbox, node)) return result;

    const nodesToSearch: Node<T>[] = [];

    while (node) {
      for (let i = 0; i < node.children.length; i++) {
        const childBBox = calcChildBBox(node, i, this.toBBox);

        if (intersects(bbox, childBBox)) {
          if (node.leaf === true) result.push(node.children[i]);
          else {
            if (contains(bbox, childBBox)) {
              this._all(node.children[i], result);
            } else nodesToSearch.push(node.children[i]);
          }
        }
      }
      node = nodesToSearch.pop();
    }

    return result;
  }

  collides(bbox: BBox): boolean {
    let node = this.data;

    if (!intersects(bbox, node)) return false;

    const nodesToSearch = [];
    while (node) {
      for (let i = 0; i < node.children.length; i++) {
        const childBBox = calcChildBBox(node, i, this.toBBox);

        if (intersects(bbox, childBBox)) {
          if (node.leaf || contains(bbox, childBBox)) return true;
          nodesToSearch.push(node.children[i]);
        }
      }
      node = nodesToSearch.pop();
    }

    return false;
  }

  load(data: T[]): RBush<T> {
    if (!(data && data.length)) return this;

    if (data.length < this._minEntries) {
      for (let i = 0; i < data.length; i++) {
        this.insert(data[i]);
      }
      return this;
    }

    // recursively build the tree with the given data from scratch using OMT algorithm
    let node = this._build(data.slice(), 0, data.length - 1, 0);

    if (!this.data.children.length) {
      // save as is if tree is empty
      this.data = node;
    } else if (this.data.height === node.height) {
      // split root if trees have the same height
      this._splitRoot(this.data, node);
    } else {
      if (this.data.height < node.height) {
        // swap trees if inserted one is bigger
        const tmpNode = this.data;
        this.data = node;
        node = tmpNode;
      }

      // insert the small tree into the large tree at appropriate level
      this._insert(node, this.data.height - node.height - 1, true);
    }

    return this;
  }

  insert(item: T): RBush<T> {
    assert(this.data.height >= 1);

    if (item) this._insert(item, this.data.height - 1, false);
    return this;
  }

  clear(): RBush<T> {
    this.data = createLeaf([]);
    return this;
  }

  remove(item?: T, equalsFn?: EqualsFn<T>): RBush<T> {
    if (!item) return this;

    let node: Node<T> | null = this.data;
    const bbox = this.toBBox(item);
    const path: Array<Node<T>> = [];
    const indexes = [];
    let i: number;
    let parent: Node<T>;
    let goingUp: boolean;

    // depth-first iterative tree traversal
    while (node || path.length) {
      if (!node) {
        // go up
        node = path.pop();
        parent = path[path.length - 1];
        i = indexes.pop();
        goingUp = true;
      }

      if (node.leaf) {
        // check current node
        const index = findItem(item, node.children, equalsFn);

        if (index !== -1) {
          // item found, remove the item and condense tree upwards
          node.children.splice(index, 1);
          path.push(node);
          this._condense(path);
          return this;
        }
      }

      if (!goingUp && !node.leaf && contains(node, bbox)) {
        // go down
        path.push(node);
        indexes.push(i);
        i = 0;
        parent = node;
        node = node.children[0] as Branch<T>;
      } else if (parent) {
        // go right
        i++;
        node = parent.children[i] as Branch<T>;
        goingUp = false;
      } else node = null; // nothing found
    }

    return this;
  }

  toJSON(): Node<T> {
    return deepClone(this.data);
  }

  fromJSON(data: Node<T>): RBush<T> {
    this.data = deepClone(data);
    return this;
  }

  private _all(node: Node<T>, result: Array<T>): T[] {
    const nodesToSearch: Array<Node<T>> = [];
    while (node) {
      if (node.leaf === true) result.push(...node.children);
      else {
        nodesToSearch.push(...node.children);
      }

      node = nodesToSearch.pop();
    }
    return result;
  }

  private _build(
    items: T[],
    left: number,
    right: number,
    height: number,
  ): Node<T> {
    const N = right - left + 1;
    let M = this._maxEntries;

    if (N <= M) {
      // reached leaf level; return leaf
      const leaf = createLeaf(items.slice(left, right + 1));
      calcBBox(leaf, this.toBBox);
      return leaf;
    }

    if (!height) {
      // target height of the bulk-loaded tree
      height = Math.ceil(Math.log(N) / Math.log(M));

      // target number of root entries to maximize storage utilization
      M = Math.ceil(N / Math.pow(M, height - 1));
    }

    const node = createNode<T>([], height);

    // split the items into M mostly square tiles

    const N2 = Math.ceil(N / M);
    const N1 = N2 * Math.ceil(Math.sqrt(M));

    multiSelect(items, left, right, N1, this.compareMinX);

    for (let i = left; i <= right; i += N1) {
      const right2 = Math.min(i + N1 - 1, right);

      multiSelect(items, i, right2, N2, this.compareMinY);

      for (let j = i; j <= right2; j += N2) {
        const right3 = Math.min(j + N2 - 1, right2);

        // pack each entry recursively
        node.children.push(this._build(items, j, right3, height - 1));
      }
    }

    calcBBox(node, this.toBBox);

    return node;
  }

  private _chooseSubtree(
    bbox: BBox,
    node: Node<T>,
    level: number,
    path: Node<T>[],
  ): Node<T> {
    while (true) {
      path.push(node);

      if (node.leaf === true || path.length - 1 === level) break;

      let minArea = Infinity;
      let minEnlargement = Infinity;
      let targetNode: Node<T>;

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const area = bboxArea(child);
        const enlargement = enlargedArea(bbox, child) - area;

        // choose entry with the least area enlargement
        if (enlargement < minEnlargement) {
          minEnlargement = enlargement;
          minArea = area < minArea ? area : minArea;
          targetNode = child;
        } else if (enlargement === minEnlargement) {
          // otherwise choose one with the smallest area
          if (area < minArea) {
            minArea = area;
            targetNode = child;
          }
        }
      }

      node = targetNode || node.children[0];
    }

    return node;
  }

  private _insert(item: Node<T>, level: number, isNode: true): void;
  private _insert(item: T, level: number, isNode: false): void;
  private _insert(item: T | Node<T>, level: number, isNode?: boolean): void {
    const bbox: BBox = isNode ? (item as Node<T>) : this.toBBox(item as T);

    const insertPath: Node<T>[] = [];

    // find the best node for accommodating the item, saving all nodes along the path too
    const node = this._chooseSubtree(bbox, this.data, level, insertPath);

    // put the item into the node
    if (node.leaf) {
      node.children.push(item as T);
    } else {
      node.children.push(item as Node<T>);
    }
    extend(node, bbox);

    // split on node overflow; propagate upwards if necessary
    while (level >= 0) {
      if (insertPath[level].children.length > this._maxEntries) {
        this._split(insertPath, level);
        level--;
      } else break;
    }

    // adjust bboxes along the insertion path
    this._adjustParentBBoxes(bbox, insertPath, level);
  }

  // split overflowed node into two
  private _split(insertPath: Node<T>[], level: number): void {
    const node = insertPath[level];

    const M = node.children.length;
    const m = this._minEntries;

    this._chooseSplitAxis(node, m, M);

    const splitIndex = this._chooseSplitIndex(node, m, M);

    let newNode: Node<T>;
    if (node.leaf === true) {
      newNode = createLeaf(
        node.children.splice(splitIndex, node.children.length - splitIndex),
      );
    } else {
      newNode = createNode(
        node.children.splice(splitIndex, node.children.length - splitIndex),
        node.height,
      );
    }

    calcBBox(node, this.toBBox);
    calcBBox(newNode, this.toBBox);

    if (level) insertPath[level - 1].children.push(newNode);
    else this._splitRoot(node, newNode);
  }

  private _splitRoot(node: Node<T>, newNode: Node<T>): void {
    // split root node
    this.data = createNode([node, newNode], node.height + 1);
    calcBBox(this.data, this.toBBox);
  }

  private _chooseSplitIndex(node: Node<T>, m: number, M: number): number {
    let index: number = undefined;
    let minOverlap = Infinity;
    let minArea = Infinity;

    for (let i = m; i <= M - m; i++) {
      const bbox1 = distBBox(node, 0, i, this.toBBox);
      const bbox2 = distBBox(node, i, M, this.toBBox);

      const overlap = intersectionArea(bbox1, bbox2);
      const area = bboxArea(bbox1) + bboxArea(bbox2);

      // choose distribution with minimum overlap
      if (overlap < minOverlap) {
        minOverlap = overlap;
        index = i;

        minArea = area < minArea ? area : minArea;
      } else if (overlap === minOverlap) {
        // otherwise choose distribution with minimum area
        if (area < minArea) {
          minArea = area;
          index = i;
        }
      }
    }

    return index || M - m;
  }

  // sorts node children by the best axis for split
  private _chooseSplitAxis(node: Node<T>, m: number, M: number): void {
    const xMargin = this._allDistMargin(node, m, M);
    const yMargin = this._allDistMargin(node, m, M);

    // if total distributions margin value is minimal for x, sort by minX,
    // otherwise it's already sorted by minY
    if (xMargin < yMargin) {
      if (node.leaf === true) {
        node.children.sort(this.compareMinX);
      } else {
        node.children.sort(compareNodeMinX);
      }
    }
  }

  // total margin of all possible split distributions where each node is at least m full
  private _allDistMargin(node: Node<T>, m: number, M: number): number {
    if (node.leaf === true) {
      node.children.sort(this.compareMinX);
    } else {
      node.children.sort(compareNodeMinX);
    }

    const leftBBox = distBBox(node, 0, m, this.toBBox);
    const rightBBox = distBBox(node, M - m, M, this.toBBox);
    let margin = bboxMargin(leftBBox) + bboxMargin(rightBBox);

    for (let i = m; i < M - m; i++) {
      extend(leftBBox, calcChildBBox(node, i, this.toBBox));
      margin += bboxMargin(leftBBox);
    }

    for (let i = M - m - 1; i >= m; i--) {
      extend(rightBBox, calcChildBBox(node, i, this.toBBox));
      margin += bboxMargin(rightBBox);
    }

    return margin;
  }

  private _adjustParentBBoxes(
    bbox: BBox,
    path: Node<T>[],
    level: number,
  ): void {
    // adjust bboxes along the given tree path
    for (let i = level; i >= 0; i--) {
      extend(path[i], bbox);
    }
  }

  private _condense(path: Array<Node<T>>): void {
    // go through the path, removing empty nodes and updating bboxes
    let siblings: Array<Node<T>> | Array<T>;

    for (let i = path.length - 1; i >= 0; i--) {
      if (path[i].children.length === 0) {
        if (i > 0) {
          siblings = path[i - 1].children;
          siblings.splice(siblings.indexOf(path[i]), 1);
        } else this.clear();
      } else calcBBox(path[i], this.toBBox);
    }
  }
}

function deepClone<T>(obj: T, cloned = new WeakMap()): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (cloned.has(obj)) {
    return cloned.get(obj) as T; // 这里需要使用类型断言
  }

  const clone = Array.isArray(obj) ? [] : {};
  cloned.set(obj, clone);

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== null && typeof value === 'object') {
        // 递归克隆并设置到 clone 中
        clone[key as string] = deepClone(value, cloned);
      } else {
        clone[key as string] = value;
      }
    }
  }

  return clone as T;
}

function createLeaf<T>(children: Array<T>): Leaf<T> {
  return {
    children,
    height: 1,
    leaf: true,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
}

function createNode<T>(children: Array<Node<T>>, height: number): Branch<T> {
  assert(height > 1);
  return {
    children,
    height,
    leaf: false,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
}

// calculate node's bbox from bboxes of its children
function calcBBox<T>(node: Node<T>, toBBox: ToBBox<T>): void {
  distBBox(node, 0, node.children.length, toBBox, node);
}

function calcChildBBox<T>(
  node: Node<T>,
  index: number,
  toBBox: ToBBox<T>,
): BBox {
  if (node.leaf === true) {
    return toBBox(node.children[index]);
  }

  return node.children[index];
}

// min bounding rectangle of node children from k to p-1
function distBBox<T>(
  node: Readonly<Node<T>>,
  k: number,
  p: number,
  toBBox: ToBBox<T>,
): Node<T>;
function distBBox<T>(
  node: Readonly<Node<T>>,
  k: number,
  p: number,
  toBBox: ToBBox<T>,
  destNode: Node<T>,
): void;
function distBBox<T>(
  node: Readonly<Node<T>>,
  k: number,
  p: number,
  toBBox: ToBBox<T>,
  destNode?: Node<T>,
): Node<T> | void {
  if (!destNode)
    destNode = node.leaf ? createLeaf([]) : createNode([], node.height);
  destNode.minX = Infinity;
  destNode.minY = Infinity;
  destNode.maxX = -Infinity;
  destNode.maxY = -Infinity;

  for (let i = k; i < p; i++) {
    extend(destNode, calcChildBBox(node, i, toBBox));
  }

  return destNode;
}

function intersectionArea(a: Readonly<BBox>, b: Readonly<BBox>): number {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);

  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

function extend(a: BBox, b: Readonly<BBox>): void {
  a.minX = Math.min(a.minX, b.minX);
  a.minY = Math.min(a.minY, b.minY);
  a.maxX = Math.max(a.maxX, b.maxX);
  a.maxY = Math.max(a.maxY, b.maxY);
}

function bboxArea(a: BBox): number {
  return (a.maxX - a.minX) * (a.maxY - a.minY);
}

function bboxMargin(a: BBox): number {
  return a.maxX - a.minX + (a.maxY - a.minY);
}

function enlargedArea(a: Readonly<BBox>, b: Readonly<BBox>): number {
  return (
    (Math.max(b.maxX, a.maxX) - Math.min(b.minX, a.minX)) *
    (Math.max(b.maxY, a.maxY) - Math.min(b.minY, a.minY))
  );
}

function compareNodeMinX(a: Readonly<BBox>, b: Readonly<BBox>): number {
  return a.minX - b.minX;
}

function compareNodeMinY(a: Readonly<BBox>, b: Readonly<BBox>): number {
  return a.minY - b.minY;
}

function findItem<T>(item: T, items: T[], equalsFn?: EqualsFn<T>): number {
  if (!equalsFn) return items.indexOf(item);

  for (let i = 0; i < items.length; i++) {
    if (equalsFn(item, items[i])) return i;
  }
  return -1;
}

function contains(a: Readonly<BBox>, b: Readonly<BBox>): boolean {
  return (
    a.minX <= b.minX && a.minY <= b.minY && b.maxX <= a.maxX && b.maxY <= a.maxY
  );
}

function intersects(a: Readonly<BBox>, b: Readonly<BBox>): boolean {
  return (
    b.minX <= a.maxX && b.minY <= a.maxY && b.maxX >= a.minX && b.maxY >= a.minY
  );
}

// sort an array so that items come in groups of n unsorted items, with groups sorted between each other;
// combines selection algorithm with binary divide & conquer approach
function multiSelect<T>(
  arr: T[],
  left: number,
  right: number,
  n: number,
  compare: compareMin<T>,
): void {
  const stack = [left, right];

  while (stack.length) {
    right = stack.pop();
    left = stack.pop();

    if (right - left <= n) continue;

    const mid = left + Math.ceil((right - left) / n / 2) * n;
    quickselect(arr, mid, left, right, compare);

    stack.push(left, mid, mid, right);
  }
}
