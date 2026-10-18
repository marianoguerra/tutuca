// Ports of test/components/drawing-math.test.js not already in math_wbtest.mbt.

///|
test "math components have the generic properties" {
  @testing.check_component(quadratic, count=25)
  @testing.check_component(matrix2, count=25)
  @testing.check_component(workbench, count=25)
  @testing.check_component(formula_gallery, count=25)
}
