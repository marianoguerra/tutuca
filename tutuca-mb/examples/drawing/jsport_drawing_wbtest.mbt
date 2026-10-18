// Ports of test/components/drawing-math.test.js not already in drawing_wbtest.mbt.

///|
test "drawing components have the generic properties" {
  @testing.check_component(drawing, count=25)
  @testing.check_component(rect_shape, count=25)
  @testing.check_component(ellipse_shape, count=25)
  @testing.check_component(line_shape, count=25)
  @testing.check_component(polyline_shape, count=25)
  @testing.check_component(shape_view, count=25)
}
