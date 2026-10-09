cmake_minimum_required(VERSION 3.5)
project(qjs-ffi VERSION 0.9 LANGUAGES C)

option(BUILD_STATIC_MODULES "Also build a static quickjs-ffi module (${CMAKE_CURRENT_BINARY_DIR}/quickjs-ffi.a)" OFF)
option(BUILD_LIBFFI "Checkout libffi into third_party/libffi and build it from source instead of using the system library" OFF)
option(ENABLE_TCC "Checkout TinyCC into third_party/tinycc, build libtcc from source and export cc() (in-memory C compiler) from the ffi module" OFF)

message("Building project [1;31m${PROJECT_NAME}[0m")

set(DISABLE_WERROR ON)

include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/UseMultiArch.cmake)
include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/FindQuickJS.cmake)

if(NOT PKG_CONFIG_FOUND)
  include(FindPkgConfig)
endif(NOT PKG_CONFIG_FOUND)

if(BUILD_LIBFFI)
  # quickjs-ffi (MODULE, needs -fPIC code) always gets the PIC build;
  # quickjs-ffi-static gets its own non--fPIC build further down, once
  # BUILD_STATIC_MODULES's target exists to link it into.
  include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/BuildLibFFI.cmake)
  build_libffi(libffi-shared PIC)
  set(LIBFFI_LIBRARY "${libffi-shared_LIBRARY}")
  set(LIBFFI_INCLUDE_DIRd "${libffi-shared_INCLUDE_DIR}")
  set(FFI_FOUND TRUE)
else(BUILD_LIBFFI)
  pkg_search_module(LIBFFI libffi)

  if(pkgcfg_lib_LIBFFI_ffi)
    set(LIBFFI_LIBRARY ${pkgcfg_lib_LIBFFI_ffi})
  endif(pkgcfg_lib_LIBFFI_ffi)

  if(NOT LIBFFI_FOUND)
    find_library(LIBFFI_LIBRARY ffi)
  endif(NOT LIBFFI_FOUND)
endif(BUILD_LIBFFI)

if(ENABLE_TCC)
  include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/BuildLibTCC.cmake)
  build_libtcc(libtcc-shared PIC)
  include_directories("${libtcc-shared_INCLUDE_DIR}")
endif(ENABLE_TCC)

find_library(LIBDL dl)

if(LIBDL)
  link_libraries(${LIBDL})
endif(LIBDL)

if(EXISTS "${LIBFFI_INCLUDE_DIR}")
  include_directories("${LIBFFI_INCLUDE_DIR}")
endif(EXISTS "${LIBFFI_INCLUDE_DIR}")

if(LIBFFI_LIBRARY)
  message(STATUS "Found LIBFFI_LIBRARY at ${LIBFFI_LIBRARY}")
  set(FFI_FOUND TRUE)
endif(LIBFFI_LIBRARY)

find_quickjs()
configure_quickjs()

include_directories(${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/..
                    ${CMAKE_CURRENT_SOURCE_DIR}/../..)
if(CMAKE_SYSTEM_INCLUDE_PATH)
  include_directories(${CMAKE_SYSTEM_INCLUDE_PATH})
endif(CMAKE_SYSTEM_INCLUDE_PATH)

set(DISABLE_WERROR TRUE)

file(GLOB JS_BINDINGS_SOURCES *.[ch])

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(CheckLibraryExists)

if(NOT PKG_CONFIG_FOUND)
  include(FindPkgConfig)
endif(NOT PKG_CONFIG_FOUND)
if(NOT FFI_FOUND)
  pkg_search_module(FFI libffi)

  if(pkgcfg_lib_FFI_ffi)
    set(LIBFFI_LIBRARY "${pkgcfg_lib_FFI_ffi}")
    set(FFI_FOUND TRUE)
  endif(pkgcfg_lib_FFI_ffi)
endif(NOT FFI_FOUND)

if(FFI_FOUND)
  set(HAVE_LIBFFI TRUE)
endif(FFI_FOUND)
# check_library_exists(ffi ffi_call "" HAVE_LIBFFI)

if(BUILD_SHARED_LIBS)
  add_definitions(-DJS_SHARED_LIBRARY)
endif(BUILD_SHARED_LIBS)

# Main
add_library(quickjs-ffi MODULE ${JS_BINDINGS_SOURCES})
target_include_directories(quickjs-ffi PRIVATE)
set_target_properties(quickjs-ffi PROPERTIES PREFIX "" OUTPUT_NAME "ffi")
target_compile_definitions(quickjs-ffi PRIVATE -DJS_SHARED_LIBRARY=1 -DJS_BINDINGS_INIT_MODULE=1)
target_link_libraries(quickjs-ffi PUBLIC ${QUICKJS_LIBRARY} ${FFI_LIBRARIES} ${LIBFFI_LIBRARY})
if(BUILD_LIBFFI)
  add_dependencies(quickjs-ffi libffi-shared)
endif(BUILD_LIBFFI)
if(ENABLE_TCC)
  target_compile_definitions(quickjs-ffi PRIVATE -DCONFIG_TCC=1 "-DCONFIG_TCC_LIB_DIR=\"${libtcc-shared_LIB_DIR}\"")
  target_link_libraries(quickjs-ffi PUBLIC ${libtcc-shared_LIBRARY} m)
  add_dependencies(quickjs-ffi libtcc-shared)
endif(ENABLE_TCC)

if(BUILD_STATIC_MODULES)
  # Statically-linked module: no JS_SHARED_LIBRARY define, so ffi.c's
  # JS_INIT_MODULE macro resolves to js_init_module_ffi (the symbol a host
  # embedding this module statically calls by name), not js_init_module
  # (the dlopen-discoverable name the MODULE target above uses).
  add_library(quickjs-ffi-static STATIC ${JS_BINDINGS_SOURCES})
  target_include_directories(quickjs-ffi-static PRIVATE)
  set_target_properties(quickjs-ffi-static PROPERTIES PREFIX "" OUTPUT_NAME "quickjs-ffi"
                         ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
  target_compile_definitions(quickjs-ffi-static PRIVATE -DJS_BINDINGS_INIT_MODULE=1)

  if(BUILD_LIBFFI)
    # A separate, non--fPIC libffi build for the static target -- the
    # -fPIC one above is only meant for linking into the MODULE's shared
    # object.
    build_libffi(libffi-static)
    set(FFI_STATIC_LIBFFI "${libffi-static_LIBRARY}")
    target_link_libraries(quickjs-ffi-static PUBLIC ${QUICKJS_LIBRARY} ${FFI_LIBRARIES} ${FFI_STATIC_LIBFFI})
    add_dependencies(quickjs-ffi-static libffi-static)
  else(BUILD_LIBFFI)
    set(FFI_STATIC_LIBFFI "${LIBFFI_LIBRARY}")
    target_link_libraries(quickjs-ffi-static PUBLIC ${QUICKJS_LIBRARY} ${FFI_LIBRARIES} ${FFI_STATIC_LIBFFI})
  endif(BUILD_LIBFFI)

  if(ENABLE_TCC)
    # Likewise a separate, non--fPIC libtcc build for the static target.
    build_libtcc(libtcc-static)
    target_compile_definitions(quickjs-ffi-static PRIVATE -DCONFIG_TCC=1 "-DCONFIG_TCC_LIB_DIR=\"${libtcc-static_LIB_DIR}\"")
    target_include_directories(quickjs-ffi-static PRIVATE "${libtcc-static_INCLUDE_DIR}")
    target_link_libraries(quickjs-ffi-static PUBLIC ${libtcc-static_LIBRARY} m)
    add_dependencies(quickjs-ffi-static libtcc-static)
    list(APPEND FFI_STATIC_LIBFFI "${libtcc-static_LIBRARY}" m)
  endif(ENABLE_TCC)

  # quickjs-ffi.a (a plain archive, unlike the MODULE target above) carries
  # no transitive link info of its own -- a consumer linking it in outside
  # this project's own CMake graph (e.g. bundling several quickjs-*-static
  # modules into one executable) needs it spelled out separately.
  set(QUICKJS_FFI_LIBRARIES ${QUICKJS_LIBRARY} ${FFI_LIBRARIES} ${FFI_STATIC_LIBFFI})
  if(LIBDL)
    list(APPEND QUICKJS_FFI_LIBRARIES ${LIBDL})
  endif(LIBDL)
  set(QUICKJS_FFI_LINK_FLAGS "")
  file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/quickjs-ffi.cmake"
"# Generated by qjs-ffi's CMakeLists.txt -- describes quickjs-ffi.a's
# transitive (system/in-tree) library dependencies and linker flags, for a
# consumer linking it in directly rather than through this CMake project.
set(QUICKJS_FFI_LIBRARIES \"${QUICKJS_FFI_LIBRARIES}\")
set(QUICKJS_FFI_LINK_FLAGS \"${QUICKJS_FFI_LINK_FLAGS}\")
")
endif(BUILD_STATIC_MODULES)

if(NOT CMAKE_INSTALL_LIBDIR)
  set(CMAKE_INSTALL_LIBDIR lib)
endif(NOT CMAKE_INSTALL_LIBDIR)
if(NOT QUICKJS_C_MODULE_DIR)
  set(QUICKJS_C_MODULE_DIR "${CMAKE_INSTALL_LIBDIR}/quickjs")
endif(NOT QUICKJS_C_MODULE_DIR)
if(NOT CMAKE_INSTALL_BINDIR)
  set(CMAKE_INSTALL_BINDIR bin)
endif(NOT CMAKE_INSTALL_BINDIR)

install(TARGETS quickjs-ffi DESTINATION "${QUICKJS_C_MODULE_DIR}"
        PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ
                    WORLD_EXECUTE)

# lib/ffi/legacy.js (define()/call() on top of CFunction) sits in the build directory too,
# so that one QUICKJS_MODULE_PATH finds it.
configure_file(lib/ffi/legacy.js "${CMAKE_CURRENT_BINARY_DIR}/ffi/legacy.js" COPYONLY)

# node/ffi.js (the API of node:ffi on top of this module) sits in the build directory too.
configure_file(lib/node/ffi.js "${CMAKE_CURRENT_BINARY_DIR}/node/ffi.js" COPYONLY)

# lib/ (bindings/*.js generated bindings, ffi/legacy.js, node/ffi.js, posix/*.js) is installed as a tree.
install(
  DIRECTORY lib/
  DESTINATION "${QUICKJS_JS_MODULE_DIR}"
  FILES_MATCHING PATTERN "*.js"
)

if(NOT CMAKE_INSTALL_DATADIR)
  set(CMAKE_INSTALL_DATADIR share)
endif(NOT CMAKE_INSTALL_DATADIR)

# tools/*.js are qjsm scripts, not compiled binaries. gen-bindings.js imports
# the modules in tools/gen-bindings/ relative to its own path, which qjsm
# resolves against the path the script is run as, not a symlink's target. So
# the tree is installed as a whole and bin/ gets two-line wrappers importing
# it by its installed path.
install(DIRECTORY tools/ DESTINATION "${CMAKE_INSTALL_DATADIR}/qjs-ffi/tools" FILES_MATCHING PATTERN "*.js")
install(CODE "set(QJS_FFI_BINDIR \"${CMAKE_INSTALL_BINDIR}\")
set(QJS_FFI_DATADIR \"${CMAKE_INSTALL_DATADIR}\")")
install(SCRIPT cmake/install-tool-wrappers.cmake)

include(CTest)

#file(GLOB TESTS tests/*.js)
#foreach(TEST ${TESTS})
#  basename(NAME "${TEST}")
#  add_test(NAME "${NAME}" WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" COMMAND sh "${TEST}")
#endforeach()

add_test(NAME "tests/run-all.sh" WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" COMMAND sh "tests/run-all.sh")
