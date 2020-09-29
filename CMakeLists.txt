cmake_minimum_required(VERSION 3.0)
project(qjs-ffi)

 

set(DISABLE_WERROR TRUE)
 
 

function(make_shared_module FNAME)
  string(REGEX REPLACE "_" "-" NAME "${FNAME}")
  string(TOUPPER "${FNAME}" UNAME)

  message("Module: ${NAME}")
  set(TARGET_NAME quickjs-${NAME})

  add_library(${TARGET_NAME} SHARED ${FNAME}.c)

  target_link_libraries(${TARGET_NAME}  quickjs dl)
  set_target_properties(
    ${TARGET_NAME}
    PROPERTIES PREFIX ""
               BUILD_RPATH "${CMAKE_CURRENT_BINARY_DIR}"
               INSTALL_RPATH "${CMAKE_INSTALL_PREFIX}/lib"
               OUTPUT_NAME "${NAME}"
               # COMPILE_FLAGS "-fvisibility=hidden"
               BUILD_RPATH "${CMAKE_BINARY_DIR};${CMAKE_CURRENT_BINARY_DIR};${CMAKE_BINARY_DIR}/quickjs;${CMAKE_CURRENT_BINARY_DIR}/quickjs")
  target_compile_definitions(${TARGET_NAME} PRIVATE -DJS_${UNAME}_MODULE=1)
  install(TARGETS ${TARGET_NAME} DESTINATION lib/quickjs)
 
endfunction()
 
file(GLOB JS_BINDINGS_SOURCES ffi.c  )

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(CheckLibraryExists)

check_library_exists(ffi ffi_call "" HAVE_LIBFFI)

if(HAVE_LIBFFI)
  link_libraries(ffi)
endif(HAVE_LIBFFI)

if(BUILD_SHARED_LIBS)
add_definitions(-DJS_SHARED_LIBRARY)
endif(BUILD_SHARED_LIBS)
# Main
add_library(quickjs-ffi MODULE ${JS_BINDINGS_SOURCES})
target_include_directories(quickjs-ffi PRIVATE )
set_target_properties(
  quickjs-ffi
  PROPERTIES COMPILE_FLAGS "-fvisibility=hidden"
             PREFIX ""
             OUTPUT_NAME "ffi"
             # OUTPUT_NAME_DEBUG "ffi-debug"
)
target_compile_definitions(quickjs-ffi PRIVATE -DJS_SHARED_LIBRARY=1 -DJS_BINDINGS_INIT_MODULE=1)
target_link_libraries(quickjs-ffi  quickjs ffi)

install(TARGETS quickjs-ffi DESTINATION lib/quickjs)

# link
