# 1.1.0

# New Features

* Added a debug flag that can be enabled by setting `DEBUG=handler` as an environment variable on the resolver lambda in the AWS console. This is off by default, but enabling it can aid in debugging unusual errors.

## Fixes
* Fix for using filters when no attribute value is provided, e.g. when using the `attributeExists` filter without any other filters [[#8]](https://github.com/multimeric/AmplifyCountDirective/issues/8)
* Fix when you provide an empty object `{}` as a filter [[#3]](https://github.com/multimeric/AmplifyCountDirective/issues/3)

## Minor Improvements

* Add test suite for the lambda handler, which should catch small bugs such as these

# 1.0.2

## Fixes

* Fix for when the directive is used multiple times on different models [[#6](https://github.com/multimeric/AmplifyCountDirective/issues/6)]