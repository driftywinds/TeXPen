Priority
- [ ] Gray out quantized selections for now (bad performance)
- [x] Unload model on page refresh, ensure never double loaded/memory leak etc.
- [x] When not inferencing, user draws something, it starts inferencing after they stop. When inferencing, finish the current execution if it takes at most 3 seconds after user stops drawing, else skip to the current stroke and perform inference

Bugs
- [ ] fix light mode

Behavior

Features
- [ ] add image upload tab
    - change loading UI to allow changing tabs while loading model, block canvas

Maintenance
- [ ] refactor and add tests