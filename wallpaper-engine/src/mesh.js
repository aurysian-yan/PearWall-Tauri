(function () {
  function add(a, b) {
    return [a[0] + b[0], a[1] + b[1]];
  }

  function scale(a, value) {
    return [a[0] * value, a[1] * value];
  }

  function divide(a, value) {
    return [a[0] / value, a[1] / value];
  }

  function identityGrid(size) {
    const points = [];
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        points.push([column / (size - 1), row / (size - 1)]);
      }
    }
    return points;
  }

  function toGrid(points, size) {
    return Array.from({ length: size }, (_, row) => (
      Array.from({ length: size }, (_, column) => points[row * size + column])
    ));
  }

  function subdivide(source) {
    const rows = source.length;
    const columns = source[0].length;
    const facePoints = Array.from({ length: rows - 1 }, (_, row) => (
      Array.from({ length: columns - 1 }, (_, column) => divide(
        add(
          add(source[row][column], source[row][column + 1]),
          add(source[row + 1][column], source[row + 1][column + 1]),
        ),
        4,
      ))
    ));
    const result = Array.from({ length: rows * 2 - 1 }, () => (
      Array.from({ length: columns * 2 - 1 }, () => [0, 0])
    ));

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const boundaryRow = row === 0 || row === rows - 1;
        const boundaryColumn = column === 0 || column === columns - 1;
        const point = source[row][column];
        let value;
        if (boundaryRow && boundaryColumn) {
          value = point;
        } else if (boundaryRow) {
          value = divide(add(add(source[row][column - 1], scale(point, 6)), source[row][column + 1]), 8);
        } else if (boundaryColumn) {
          value = divide(add(add(source[row - 1][column], scale(point, 6)), source[row + 1][column]), 8);
        } else {
          const faceAverage = divide(
            add(
              add(facePoints[row - 1][column - 1], facePoints[row - 1][column]),
              add(facePoints[row][column - 1], facePoints[row][column]),
            ),
            4,
          );
          const edgeAverage = divide(
            add(
              add(
                divide(add(point, source[row - 1][column]), 2),
                divide(add(point, source[row + 1][column]), 2),
              ),
              add(
                divide(add(point, source[row][column - 1]), 2),
                divide(add(point, source[row][column + 1]), 2),
              ),
            ),
            4,
          );
          value = divide(add(add(faceAverage, scale(edgeAverage, 2)), point), 4);
        }
        result[row * 2][column * 2] = value;
      }
    }

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        const first = source[row][column];
        const second = source[row][column + 1];
        result[row * 2][column * 2 + 1] = row === 0 || row === rows - 1
          ? divide(add(first, second), 2)
          : divide(add(add(first, second), add(facePoints[row - 1][column], facePoints[row][column])), 4);
      }
    }

    for (let row = 0; row < rows - 1; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const first = source[row][column];
        const second = source[row + 1][column];
        result[row * 2 + 1][column * 2] = column === 0 || column === columns - 1
          ? divide(add(first, second), 2)
          : divide(add(add(first, second), add(facePoints[row][column - 1], facePoints[row][column])), 4);
      }
    }

    for (let row = 0; row < rows - 1; row += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        result[row * 2 + 1][column * 2 + 1] = facePoints[row][column];
      }
    }
    return result;
  }

  function createMesh(isPortrait, presetIndex, distortionStrength = 1) {
    const size = isPortrait ? 6 : 9;
    const presets = isPortrait ? window.PearWallPresets.portrait : window.PearWallPresets.landscape;
    const preset = presets[Math.max(0, Math.min(presetIndex, presets.length - 1))];
    let from = toGrid(preset.from, size);
    let to = toGrid(preset.to, size);
    for (let pass = 0; pass < 3; pass += 1) {
      from = subdivide(from);
      to = subdivide(to);
    }

    const rows = from.length;
    const columns = from[0].length;
    const vertices = new Float32Array(rows * columns * 6);
    let vertexOffset = 0;
    for (let row = 0; row < rows; row += 1) {
      const v = row / (rows - 1);
      for (let column = 0; column < columns; column += 1) {
        const u = column / (columns - 1);
        const fromPoint = from[row][column];
        const toPoint = to[row][column];
        vertices[vertexOffset++] = (u + (fromPoint[0] - u) * distortionStrength) * 2 - 1;
        vertices[vertexOffset++] = (v + (fromPoint[1] - v) * distortionStrength) * 2 - 1;
        vertices[vertexOffset++] = (u + (toPoint[0] - u) * distortionStrength) * 2 - 1;
        vertices[vertexOffset++] = (v + (toPoint[1] - v) * distortionStrength) * 2 - 1;
        vertices[vertexOffset++] = u;
        vertices[vertexOffset++] = v;
      }
    }

    const indices = new Uint16Array((rows - 1) * (columns - 1) * 6);
    let indexOffset = 0;
    for (let row = 0; row < rows - 1; row += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        const bottomLeft = row * columns + column;
        const bottomRight = bottomLeft + 1;
        const topLeft = bottomLeft + columns;
        const topRight = topLeft + 1;
        indices[indexOffset++] = bottomLeft;
        indices[indexOffset++] = topLeft;
        indices[indexOffset++] = topRight;
        indices[indexOffset++] = topRight;
        indices[indexOffset++] = bottomRight;
        indices[indexOffset++] = bottomLeft;
      }
    }
    return { vertices, indices };
  }

  class MeshGeometry {
    constructor(gl, mesh) {
      this.gl = gl;
      this.count = mesh.indices.length;
      this.vao = gl.createVertexArray();
      this.vertexBuffer = gl.createBuffer();
      this.indexBuffer = gl.createBuffer();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 8);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
      gl.bindVertexArray(null);
    }

    draw() {
      this.gl.bindVertexArray(this.vao);
      this.gl.drawElements(this.gl.TRIANGLES, this.count, this.gl.UNSIGNED_SHORT, 0);
      this.gl.bindVertexArray(null);
    }

    destroy() {
      this.gl.deleteBuffer(this.vertexBuffer);
      this.gl.deleteBuffer(this.indexBuffer);
      this.gl.deleteVertexArray(this.vao);
    }
  }

  window.PearWallMesh = { createMesh, MeshGeometry, identityGrid };
}());
