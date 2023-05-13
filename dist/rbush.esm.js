const quickselect = require('quickselect');
function assert(condition, message) {
    if (!condition) {
        throw new Error('Assertion Error: ' + message);
    }
}
function isBBox(item) {
    const keys = ['minX', 'minY', 'maxX', 'maxY'];
    for (const key of keys) {
        if (typeof item[key] !== 'number') {
            return false;
        }
    }
    return true;
}
class RBush {
    _maxEntries;
    _minEntries;
    data;
    constructor(maxEntries = 9) {
        this._maxEntries = Math.max(4, maxEntries);
        this._minEntries = Math.max(2, Math.ceil(this._maxEntries * 0.4));
        this.clear();
    }
    toBBox(item) {
        assert(isBBox(item), '如果 item 不是 BBox 类型，需要重写 toBBox');
        return item;
    }
    compareMinX(a, b) {
        assert(isBBox(a), '如果 a 不是 BBox 类型，需要重写 compareMinX');
        assert(isBBox(b), '如果 b 不是 BBox 类型，需要重写 compareMinX');
        return compareNodeMinX(a, b);
    }
    compareMinY(a, b) {
        assert(isBBox(a), '如果 a 不是 BBox 类型，需要重写 compareMinY');
        assert(isBBox(b), '如果 b 不是 BBox 类型，需要重写 compareMinY');
        return compareNodeMinY(a, b);
    }
    all() {
        return this._all(this.data, []);
    }
    search(bbox) {
        let node = this.data;
        const result = [];
        if (!intersects(bbox, node))
            return result;
        const nodesToSearch = [];
        while (node) {
            for (let i = 0; i < node.children.length; i++) {
                const childBBox = calcChildBBox(node, i, this.toBBox);
                if (intersects(bbox, childBBox)) {
                    if (node.leaf === true)
                        result.push(node.children[i]);
                    else {
                        if (contains(bbox, childBBox)) {
                            this._all(node.children[i], result);
                        }
                        else
                            nodesToSearch.push(node.children[i]);
                    }
                }
            }
            node = nodesToSearch.pop();
        }
        return result;
    }
    collides(bbox) {
        let node = this.data;
        if (!intersects(bbox, node))
            return false;
        const nodesToSearch = [];
        while (node) {
            for (let i = 0; i < node.children.length; i++) {
                const childBBox = calcChildBBox(node, i, this.toBBox);
                if (intersects(bbox, childBBox)) {
                    if (node.leaf || contains(bbox, childBBox))
                        return true;
                    nodesToSearch.push(node.children[i]);
                }
            }
            node = nodesToSearch.pop();
        }
        return false;
    }
    load(data) {
        if (!(data && data.length))
            return this;
        if (data.length < this._minEntries) {
            for (let i = 0; i < data.length; i++) {
                this.insert(data[i]);
            }
            return this;
        }
        let node = this._build(data.slice(), 0, data.length - 1, 0);
        if (!this.data.children.length) {
            this.data = node;
        }
        else if (this.data.height === node.height) {
            this._splitRoot(this.data, node);
        }
        else {
            if (this.data.height < node.height) {
                const tmpNode = this.data;
                this.data = node;
                node = tmpNode;
            }
            this._insert(node, this.data.height - node.height - 1, true);
        }
        return this;
    }
    insert(item) {
        assert(this.data.height >= 1);
        if (item)
            this._insert(item, this.data.height - 1, false);
        return this;
    }
    clear() {
        this.data = createLeaf([]);
        return this;
    }
    remove(item, equalsFn) {
        if (!item)
            return this;
        let node = this.data;
        const bbox = this.toBBox(item);
        const path = [];
        const indexes = [];
        let i;
        let parent;
        let goingUp;
        while (node || path.length) {
            if (!node) {
                node = path.pop();
                parent = path[path.length - 1];
                i = indexes.pop();
                goingUp = true;
            }
            if (node.leaf) {
                const index = findItem(item, node.children, equalsFn);
                if (index !== -1) {
                    node.children.splice(index, 1);
                    path.push(node);
                    this._condense(path);
                    return this;
                }
            }
            if (!goingUp && !node.leaf && contains(node, bbox)) {
                path.push(node);
                indexes.push(i);
                i = 0;
                parent = node;
                node = node.children[0];
            }
            else if (parent) {
                i++;
                node = parent.children[i];
                goingUp = false;
            }
            else
                node = null;
        }
        return this;
    }
    toJSON() {
        return deepClone(this.data);
    }
    fromJSON(data) {
        this.data = deepClone(data);
        return this;
    }
    _all(node, result) {
        const nodesToSearch = [];
        while (node) {
            if (node.leaf === true)
                result.push(...node.children);
            else {
                nodesToSearch.push(...node.children);
            }
            node = nodesToSearch.pop();
        }
        return result;
    }
    _build(items, left, right, height) {
        const N = right - left + 1;
        let M = this._maxEntries;
        if (N <= M) {
            const leaf = createLeaf(items.slice(left, right + 1));
            calcBBox(leaf, this.toBBox);
            return leaf;
        }
        if (!height) {
            height = Math.ceil(Math.log(N) / Math.log(M));
            M = Math.ceil(N / Math.pow(M, height - 1));
        }
        const node = createNode([], height);
        const N2 = Math.ceil(N / M);
        const N1 = N2 * Math.ceil(Math.sqrt(M));
        multiSelect(items, left, right, N1, this.compareMinX);
        for (let i = left; i <= right; i += N1) {
            const right2 = Math.min(i + N1 - 1, right);
            multiSelect(items, i, right2, N2, this.compareMinY);
            for (let j = i; j <= right2; j += N2) {
                const right3 = Math.min(j + N2 - 1, right2);
                node.children.push(this._build(items, j, right3, height - 1));
            }
        }
        calcBBox(node, this.toBBox);
        return node;
    }
    _chooseSubtree(bbox, node, level, path) {
        while (true) {
            path.push(node);
            if (node.leaf === true || path.length - 1 === level)
                break;
            let minArea = Infinity;
            let minEnlargement = Infinity;
            let targetNode;
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                const area = bboxArea(child);
                const enlargement = enlargedArea(bbox, child) - area;
                if (enlargement < minEnlargement) {
                    minEnlargement = enlargement;
                    minArea = area < minArea ? area : minArea;
                    targetNode = child;
                }
                else if (enlargement === minEnlargement) {
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
    _insert(item, level, isNode) {
        const bbox = isNode ? item : this.toBBox(item);
        const insertPath = [];
        const node = this._chooseSubtree(bbox, this.data, level, insertPath);
        if (node.leaf) {
            node.children.push(item);
        }
        else {
            node.children.push(item);
        }
        extend(node, bbox);
        while (level >= 0) {
            if (insertPath[level].children.length > this._maxEntries) {
                this._split(insertPath, level);
                level--;
            }
            else
                break;
        }
        this._adjustParentBBoxes(bbox, insertPath, level);
    }
    _split(insertPath, level) {
        const node = insertPath[level];
        const M = node.children.length;
        const m = this._minEntries;
        this._chooseSplitAxis(node, m, M);
        const splitIndex = this._chooseSplitIndex(node, m, M);
        let newNode;
        if (node.leaf === true) {
            newNode = createLeaf(node.children.splice(splitIndex, node.children.length - splitIndex));
        }
        else {
            newNode = createNode(node.children.splice(splitIndex, node.children.length - splitIndex), node.height);
        }
        calcBBox(node, this.toBBox);
        calcBBox(newNode, this.toBBox);
        if (level)
            insertPath[level - 1].children.push(newNode);
        else
            this._splitRoot(node, newNode);
    }
    _splitRoot(node, newNode) {
        this.data = createNode([node, newNode], node.height + 1);
        calcBBox(this.data, this.toBBox);
    }
    _chooseSplitIndex(node, m, M) {
        let index = undefined;
        let minOverlap = Infinity;
        let minArea = Infinity;
        for (let i = m; i <= M - m; i++) {
            const bbox1 = distBBox(node, 0, i, this.toBBox);
            const bbox2 = distBBox(node, i, M, this.toBBox);
            const overlap = intersectionArea(bbox1, bbox2);
            const area = bboxArea(bbox1) + bboxArea(bbox2);
            if (overlap < minOverlap) {
                minOverlap = overlap;
                index = i;
                minArea = area < minArea ? area : minArea;
            }
            else if (overlap === minOverlap) {
                if (area < minArea) {
                    minArea = area;
                    index = i;
                }
            }
        }
        return index || M - m;
    }
    _chooseSplitAxis(node, m, M) {
        const xMargin = this._allDistMargin(node, m, M);
        const yMargin = this._allDistMargin(node, m, M);
        if (xMargin < yMargin) {
            if (node.leaf === true) {
                node.children.sort(this.compareMinX);
            }
            else {
                node.children.sort(compareNodeMinX);
            }
        }
    }
    _allDistMargin(node, m, M) {
        if (node.leaf === true) {
            node.children.sort(this.compareMinX);
        }
        else {
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
    _adjustParentBBoxes(bbox, path, level) {
        for (let i = level; i >= 0; i--) {
            extend(path[i], bbox);
        }
    }
    _condense(path) {
        let siblings;
        for (let i = path.length - 1; i >= 0; i--) {
            if (path[i].children.length === 0) {
                if (i > 0) {
                    siblings = path[i - 1].children;
                    siblings.splice(siblings.indexOf(path[i]), 1);
                }
                else
                    this.clear();
            }
            else
                calcBBox(path[i], this.toBBox);
        }
    }
}
function deepClone(obj, cloned = new WeakMap()) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (cloned.has(obj)) {
        return cloned.get(obj);
    }
    const clone = Array.isArray(obj) ? [] : {};
    cloned.set(obj, clone);
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            if (value !== null && typeof value === 'object') {
                clone[key] = deepClone(value, cloned);
            }
            else {
                clone[key] = value;
            }
        }
    }
    return clone;
}
function createLeaf(children) {
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
function createNode(children, height) {
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
function calcBBox(node, toBBox) {
    distBBox(node, 0, node.children.length, toBBox, node);
}
function calcChildBBox(node, index, toBBox) {
    if (node.leaf === true) {
        return toBBox(node.children[index]);
    }
    return node.children[index];
}
function distBBox(node, k, p, toBBox, destNode) {
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
function intersectionArea(a, b) {
    const minX = Math.max(a.minX, b.minX);
    const minY = Math.max(a.minY, b.minY);
    const maxX = Math.min(a.maxX, b.maxX);
    const maxY = Math.min(a.maxY, b.maxY);
    return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}
function extend(a, b) {
    a.minX = Math.min(a.minX, b.minX);
    a.minY = Math.min(a.minY, b.minY);
    a.maxX = Math.max(a.maxX, b.maxX);
    a.maxY = Math.max(a.maxY, b.maxY);
}
function bboxArea(a) {
    return (a.maxX - a.minX) * (a.maxY - a.minY);
}
function bboxMargin(a) {
    return a.maxX - a.minX + (a.maxY - a.minY);
}
function enlargedArea(a, b) {
    return ((Math.max(b.maxX, a.maxX) - Math.min(b.minX, a.minX)) *
        (Math.max(b.maxY, a.maxY) - Math.min(b.minY, a.minY)));
}
function compareNodeMinX(a, b) {
    return a.minX - b.minX;
}
function compareNodeMinY(a, b) {
    return a.minY - b.minY;
}
function findItem(item, items, equalsFn) {
    if (!equalsFn)
        return items.indexOf(item);
    for (let i = 0; i < items.length; i++) {
        if (equalsFn(item, items[i]))
            return i;
    }
    return -1;
}
function contains(a, b) {
    return (a.minX <= b.minX && a.minY <= b.minY && b.maxX <= a.maxX && b.maxY <= a.maxY);
}
function intersects(a, b) {
    return (b.minX <= a.maxX && b.minY <= a.maxY && b.maxX >= a.minX && b.maxY >= a.minY);
}
function multiSelect(arr, left, right, n, compare) {
    const stack = [left, right];
    while (stack.length) {
        right = stack.pop();
        left = stack.pop();
        if (right - left <= n)
            continue;
        const mid = left + Math.ceil((right - left) / n / 2) * n;
        quickselect(arr, mid, left, right, compare);
        stack.push(left, mid, mid, right);
    }
}

export { RBush as default };
//# sourceMappingURL=rbush.esm.js.map
