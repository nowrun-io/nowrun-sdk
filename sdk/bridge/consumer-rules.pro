# Applied to the host app's R8 run automatically, via consumerProguardFiles.

# Your functions class is reached only by reflection, so nothing references it and R8
# will rename or drop its methods. The SDK cannot write that rule for you - it does not
# know your class names - so add it to your own app's rules, along with any class of your
# own that a function takes as an argument, since its fields are filled by name:
#
#   -keep class com.example.yourapp.AppFunctions { public <methods>; }
#   -keep class com.example.yourapp.Move { <fields>; }

# Reflection reads parameter generics (List<Move>), @Describe and @Subtypes, and subclasses
# nested in a type - all kept in attributes R8 strips by default.
-keepattributes Signature,RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,InnerClasses,EnclosingMethod
-keep class gg.now.bridge.ProviderService$Describe { *; }
-keep class gg.now.bridge.ProviderService$Subtypes { *; }

# Named in the merged manifest and instantiated by the platform.
-keep class gg.now.bridge.ProviderService { *; }

# Binder stubs: the platform reaches asInterface() and the Stub constructors reflectively.
-keep class gg.now.bridge.aidl.** { *; }
